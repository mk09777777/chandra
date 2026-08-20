const repo = require('../repositories/enquiry.repo');
const userService = require("../services/user.service");
const clientService = require("../services/client.service");
const metalPricesService = require("../services/metalPrices.service");
const chatService = require('./chat.service');
const { uploadToS3, generatePresignedUrl } = require('../utils/s3');
const { v4: uuidv4 } = require('uuid');
const xlsx = require('xlsx');
const codelistsService = require('../services/codelists.service');
const notificationService = require('../services/notifications.service');
const reportsService = require('../services/reports.service');
const userScope = require('./userScope.service');
const { calculatePricing: pricingCalculate, loadPricingRefs } = require('./pricing.service');
const { extractPricingDataFromImage } = require('./imagePricing.service');
const { normalizeShape } = require('../utils/shapes');
const { deriveSubStatus, isValidPair, appendStatusEntry } = require('../utils/enquiryStatus');
const { insertDesign } = require('./designs.service');

// 'Quotation Review' only when ALL stone-type pricings are complete; else 'Cost Missing'.
function deriveCostSubStatus(asset) {
    const pricing = Array.isArray(asset?.Pricing) ? asset.Pricing : [];
    if (pricing.length === 0) return 'Cost Missing';

    const allPriced = pricing.every(p => {
        const stones = p.Stones || [];
        const stonesPriced = asset.IsOnlyMetalDesign ? true : (stones.length > 0 && stones.every(s => Number(s.Price) > 0));
        const metalPriced = Number(p.MetalPrice) > 0;
        return stonesPriced && metalPriced;
    });

    return allPriced ? 'Quotation Review' : 'Cost Missing';
}

async function scopeClientFilter(queryParams, userId) {
    // Strip the control flag up front so it can never leak into DB filters.
    const { allClients, ...params } = queryParams;
    const override = allClients === true || allClients === 'true';

    const scope = await userScope.getEnquiryScope(userId);

    // Client Handler explicitly overriding their scope (e.g. covering for an absent colleague):
    // behave exactly like an unscoped user — honor a specific requested clientId, else no client filter.
    if (scope && override) {
        return params;
    }

    const clientFilter = userScope.applyClientScope(params.clientId, scope);
    const finalParams = { ...params, ...clientFilter };
    if (clientFilter.clientIds !== undefined) delete finalParams.clientId;
    return finalParams;
}

// Best-effort: describe + embed each newly-uploaded image and store in DesignEmbedding.
// Failures are logged and swallowed — never break the upload path.
async function indexUploadedAssets({ enquiryId, type, version, uploads, stones, metal, isOnlyMetalDesign }) {
    const designType = type === 'cad' ? 'cad' : type;
    const hasStones = stones && stones.length > 0;

    for (const u of uploads) {
        try {
            if (!hasStones && !isOnlyMetalDesign) {
                console.warn(`[indexUploadedAssets] skipping design insertion for ${type} key ${u.key}: no stones and not an only-metal design`);
                continue;
            }
            await insertDesign({
                designType,
                enquiryId,
                s3Key: u.key,
                mimeType: u.mimetype,
                stones: stones || [],
                metal: metal || null,
                indexEmbedding: true,
                isOnlyMetalDesign: isOnlyMetalDesign || false,
                version: version || null,
            });
        } catch (err) {
            console.error(`[indexUploadedAssets] failed for ${type} key ${u.key}:`, err);
        }
    }
}

// Best-effort: regenerate the manufacturing checklist for an enquiry from its remarks via Gemini.
// Failures are logged and swallowed — never block the calling write path.
async function regenerateChecklist(enquiryId) {
    try {
        const enquiry = await repo.getEnquiryById(enquiryId);
        if (!enquiry) return;
        const { extractChecklist } = require('./checklistExtraction.service');
        const checklist = await extractChecklist({
            remarks: enquiry.Remarks,
            specialRemarks: enquiry.SpecialRemarks,
        });
        if (!checklist) return;
        await repo.updateChecklist(enquiryId, checklist);
    } catch (err) {
        console.error(`[regenerateChecklist] failed for enquiry ${enquiryId}:`, err);
    }
}

// Best-effort: regenerate the designer-facing markdown summary from the full enquiry via Gemini.
// Failures are logged and swallowed — never block the calling write path.
async function regenerateSummary(enquiryId) {
    try {
        const enquiry = await repo.getEnquiryById(enquiryId);
        if (!enquiry) return;
        const { generateSummary } = require('./summaryGeneration.service');
        const summary = await generateSummary(enquiry);
        if (!summary) return;
        await repo.updateSummary(enquiryId, summary);
    } catch (err) {
        console.error(`[regenerateSummary] failed for enquiry ${enquiryId}:`, err);
    }
}

// Get all enquiries
exports.getEnquiries = async () => {
    return await repo.getAllEnquiries();
};

// Get a single enquiry by ID
exports.getEnquiry = async (id) => {
    return await repo.getEnquiryById(id);
};

// Get enquiries by client id
exports.getEnquiriesByClientId = async (clientId) => {
    return await repo.getEnquiriesByClientId(clientId);
};

// Get enquiries by user id (from Participants)
exports.getEnquiriesByUserId = async (userId) => {
    return await repo.getEnquiriesByUserId(userId);
};

exports.createEnquiry = async (data, files = [], userId, referenceImageDescriptions = []) => {
    const { AssignedTo, Status, ...rest } = data;

    // Upload reference images to S3 if provided
    const ReferenceImages = [];
    for (const [index, file] of files.entries()) {
        try {
            const key = await uploadToS3(file);
            const description = referenceImageDescriptions[index] || file.originalname;
            ReferenceImages.push({
                Id: uuidv4(),
                Key: key,
                Description: description,
                MimeType: file.mimetype,
            });
        } catch (err) {
            console.error('[createEnquiry] reference image upload failed:', file?.originalname, err);
        }
    }
    if (ReferenceImages.length > 0) rest.ReferenceImages = ReferenceImages;

    const StatusHistory = [
        {
            Status: 'Enquiry Created',
            SubStatus: null,
            Timestamp: new Date(),
            AddedBy: userId || 'System'
        }
    ];

    if (AssignedTo || Status !== 'Enquiry Created') {
        StatusHistory.push({
            Status: Status,
            SubStatus: deriveSubStatus(Status, { assignedTo: AssignedTo }),
            Timestamp: new Date(),
            AssignedTo: AssignedTo || null,
            AddedBy: userId || 'System'
        });
    }

    const enquiryData = {
        ...rest,
        StatusHistory
    };

    const enquiry = await repo.createEnquiry(enquiryData);

    const adminRoleId = (await codelistsService.getCodelistByName("Roles"))?.find(role => role.Code === "AD")?.Id;
    const adminIds = await userService.getUsersByRole(adminRoleId);
    const clientIds = await userService.getUsersByClient(enquiry.ClientId);
    const designerId = AssignedTo || null;

    await chatService.createChat(enquiry._id, enquiry.Name, 'admin-client', [...adminIds, ...clientIds]);
    await chatService.createChat(enquiry._id, enquiry.Name, 'admin-designer', designerId ? [...adminIds, designerId] : [...adminIds]);

    // 5️⃣ 🔔 Send notifications
    try {
        // Build proper link format: enquiries/{enquiryId} (mobile app format - no leading slash)
        const enquiryLink = `enquiries/${enquiry._id.toString()}`;

        // Admin notifications
        await notificationService.createAlertsForUsers(
            adminIds,
            'New Enquiry Created',
            `New enquiry "${enquiry.Name}" has been created.`,
            'enquiry_created',
            enquiryLink
        );

        // Designer notification (if assigned)
        if (designerId) {
            await notificationService.createAlertsForUsers(
                [designerId], // 1. The userId (as an array)
                '🎨 New Enquiry Assigned', // 2. The title
                `You've been assigned enquiry "${enquiry.Name}".`, // 3. The body
                'enquiry_assigned', // 4. The type
                enquiryLink // 5. The in-app link (proper format: /enquiries/{id})
            );
        }

    } catch (err) {
    }

    // Fire-and-forget: image embedding, auto-assign designer, similar-design search.
    // Best-effort — failures are logged inside the hook and never block the response.
    // queueMicrotask(() => {
    //     const { postEnquiryCreateHook } = require('./enquiryAssignment.service');
    //     postEnquiryCreateHook(enquiry).catch(err =>
    //         console.error('postEnquiryCreateHook failed:', err)
    //     );
    // });

    queueMicrotask(() => regenerateChecklist(enquiry._id));
    // queueMicrotask(() => regenerateSummary(enquiry._id));

    return enquiry._id;
};

exports.deleteEnquiry = async (id) => {
    try {
        const deleted = await repo.deleteEnquiry(id);
        if (!deleted) {
            throw new Error('Enquiry not found');
        }

        await chatService.deleteChatsByEnquiryId(id);

        return deleted;
    } catch (err) {
        throw new Error('Error deleting enquiry: ' + err.message);
    }
};

exports.updateEnquiry = async (id, data, userId) => {
    const enquiry = await repo.getEnquiryById(id);
    if (!enquiry) {
        throw new Error('Enquiry not found');
    }

    const updatableFields = [
        'Name', 'Quantity', 'StyleNumber', 'ClientId',
        'Priority', 'Metal', 'Category', 'StoneTypes',
        'MetalWeight', 'DiamondWeight', 'Stamping',
        'Remarks', 'ShippingDate', 'Budget', 'SpecialRemarks',
        'ApprovedDate', 'GatiOrderNumber', 'Checklist'
    ];

    const updatedFields = {};
    const changes = [];

    for (const key of updatableFields) {
        const oldValue = JSON.stringify(enquiry[key]);
        const newValue = JSON.stringify(data[key]);

        if (data.hasOwnProperty(key) && oldValue !== newValue) {
            updatedFields[key] = data[key];
            changes.push(`${key}: from "${oldValue}" to "${newValue}"`);
        }
    }

    const oldStatusHistory = enquiry.StatusHistory.at(-1);
    const currentStatus = oldStatusHistory?.Status;
    const currentAssignee = oldStatusHistory?.AssignedTo ?? null;

    // Resolve the effective assignee once — carry the current one forward when AssignedTo isn't sent,
    // so SubStatus is always computed against the right person (and a status change never silently unassigns).
    const sentAssignee = Object.prototype.hasOwnProperty.call(data, 'AssignedTo');
    const effectiveAssignee = sentAssignee ? data.AssignedTo : currentAssignee;

    // Status is only "changed" when the client actually sends a different value (admin override).
    const statusOverride = data.Status !== undefined && data.Status !== null && data.Status !== currentStatus;
    if (statusOverride) {
        changes.push(`Status: from "${currentStatus}" to "${data.Status}"`);
        if (data.Status === 'Order Placement') {
            //TODO add changes here for approved date, style number auto generation, PO creation
            updatedFields.ApprovedDate = new Date();
        }
    }

    const assigneeChanged = sentAssignee && String(data.AssignedTo ?? '') !== String(currentAssignee ?? '');
    if (assigneeChanged) {
        let oldAssignee = await userService.getUserById(currentAssignee);
        let newAssignee = await userService.getUserById(data.AssignedTo);
        changes.push(`Assigned: from "${oldAssignee?.name}" to "${newAssignee?.name}"`);

        // 🟢 Add new designer to admin-designer chat
        if (newAssignee?._id) {
            await chatService.addParticipantIfMissing(enquiry._id, 'admin-designer', newAssignee._id);

            // 5️⃣ 🔔 Send notification to new assignee
            try {
                const enquiryLink = `enquiries/${enquiry._id.toString()}`; // Mobile app format
                await notificationService.createAlertsForUsers(
                    [newAssignee._id], // 1. The userId (as an array)
                    '🎨 New Enquiry Assigned', // 2. The title
                    `You've been assigned to enquiry "${enquiry.Name}".`, // 3. The body
                    'enquiry_assigned', // 4. The type
                    enquiryLink // 5. The in-app link (mobile app format: enquiries/{id})
                );

            } catch (err) {
                // This will now catch errors from the database save (insertMany)
                console.error(
                    `❌ Error creating notification for enquiry ${enquiry._id}:`,
                    err
                );
            }
        }
    }

    // 2️⃣ Client changed
    if (Object.prototype.hasOwnProperty.call(data, 'ClientId') && enquiry.ClientId != data.ClientId) {
        const adminRoleId = (await codelistsService.getCodelistByName("Roles"))
            ?.find(role => role.Code === "AD")?.Id;
        const adminIds = await userService.getUsersByRole(adminRoleId);
        const newClientIds = await userService.getUsersByClient(data.ClientId);

        changes.push(`Client changed: from "${enquiry.ClientId}" to "${data.ClientId}"`);

        // 🟢 Replace non-admins in admin-client chat
        await chatService.updateParticipants(enquiry._id, 'admin-client', [...adminIds, ...newClientIds]);
    }

    if (changes.length > 0) {
        const details = changes.join(', ');

        if (statusOverride) {
            // Admin override. SubStatus is optional: explicit values are validated; otherwise the
            // assignment-based sub-status is derived from the effective assignee.
            let subStatus;
            if (data.SubStatus !== undefined) {
                if (!isValidPair(data.Status, data.SubStatus)) {
                    throw Object.assign(new Error(`Invalid Status/SubStatus pair: "${data.Status}" / "${data.SubStatus}"`), { status: 400 });
                }
                subStatus = data.SubStatus;
            } else {
                subStatus = deriveSubStatus(data.Status, { assignedTo: effectiveAssignee });
            }
            appendStatusEntry(enquiry, { status: data.Status, subStatus, assignedTo: effectiveAssignee, addedBy: userId, details });
        } else if (assigneeChanged) {
            // Reassignment within the current status — derive Assigned / Assign Pending.
            appendStatusEntry(enquiry, {
                status: currentStatus,
                subStatus: deriveSubStatus(currentStatus, { assignedTo: effectiveAssignee }),
                assignedTo: effectiveAssignee,
                addedBy: userId,
                details,
            });
        } else {
            // Pure data edit — audit entry that preserves the current Status + SubStatus (no transition).
            appendStatusEntry(enquiry, {
                status: currentStatus,
                subStatus: oldStatusHistory?.SubStatus ?? null,
                assignedTo: currentAssignee,
                addedBy: userId,
                details,
            });
        }

        Object.assign(enquiry, updatedFields);
        await repo.updateEnquiry(id, enquiry);


        // 3️⃣ 🔔 Send notifications for enquiry update
        try {
            const adminRoleId = (await codelistsService.getCodelistByName("Roles"))
                ?.find(role => role.Code === "AD")?.Id;
            const adminIds = await userService.getUsersByRole(adminRoleId);
            
            const usersToNotify = [...adminIds];
            
            const assignedTo = data.AssignedTo || enquiry.StatusHistory?.at(-1)?.AssignedTo;
            if (assignedTo) {
                const assignedToStr = assignedTo.toString();
                if (!usersToNotify.some(id => id.toString() === assignedToStr)) {
                    usersToNotify.push(assignedTo);
                }
            }

            const updatingUserIdStr = userId ? userId.toString() : '';
            const assignedToStr = assignedTo ? assignedTo.toString() : '';
            const isUpdatingUserAssigned = updatingUserIdStr === assignedToStr;
            
            const usersToNotifyFiltered = usersToNotify.filter(
                notifyUserId => {
                    const notifyUserIdStr = notifyUserId.toString();
                    if (notifyUserIdStr === updatingUserIdStr && isUpdatingUserAssigned) {
                        return true;
                    }
                    return notifyUserIdStr !== updatingUserIdStr;
                }
            );

            if (usersToNotifyFiltered.length > 0) {
                let notificationTitle = 'Enquiry Updated';
                let notificationBody = `Enquiry "${enquiry.Name}" has been updated.`;

                if (statusOverride) {
                    notificationTitle = `Status Changed`;
                    notificationBody = `Enquiry "${enquiry.Name}" status changed to "${data.Status}".`;
                }

                const enquiryLink = `enquiries/${enquiry._id.toString()}`;

                await notificationService.createAlertsForUsers(
                    usersToNotifyFiltered,
                    notificationTitle,
                    notificationBody,
                    'enquiry_updated',
                    enquiryLink
                );
            }
        } catch (err) {
        }
    }

    queueMicrotask(() => regenerateChecklist(enquiry._id));
    // queueMicrotask(() => regenerateSummary(enquiry._id));

    return { _id: enquiry._id };
};

exports.handleAssetUpload = async (id, type, files, version, code, userId, cost, isFinalVersion = false, isOnlyMetalDesign = false) => {
    const enquiry = await repo.getEnquiryById(id);
    if (!enquiry) throw new Error('Enquiry not found');

    // Normalise cost: accept string ("123") or number, store as Number; null/undefined/empty -> undefined
    const parsedCost = (cost === undefined || cost === null || cost === '') ? undefined : Number(cost);
    if (parsedCost !== undefined && Number.isNaN(parsedCost)) {
        throw new Error('cost must be a valid number');
    }

    // 1) perform the upload with the right handler
    let uploadResult;
    switch (type) {
        case 'coral':
            uploadResult = await handleCoralUpload(enquiry, files, version, code, userId, parsedCost, isOnlyMetalDesign);
            break;
        case 'cad':
            uploadResult = await handleCadUpload(enquiry, files, version, code, userId, parsedCost, isFinalVersion, isOnlyMetalDesign);
            break;
        case 'reference':
            uploadResult = await handleReferenceImageUpload(enquiry, files, userId);
            break;
  
        default:
            throw new Error('Invalid asset type');
    }

    // 2) Notify admins (push) that an asset was uploaded
    try {
        // get admin role id (same pattern used elsewhere)
        const roles = await codelistsService.getCodelistByName('Roles');
        const adminRoleId = roles?.find((r) => r.Code === 'AD')?.Id;
        if (adminRoleId) {
            // get admin user ids
            let adminIds = await userService.getUsersByRole(adminRoleId); // returns user ids array
            if (adminIds && adminIds.length) {
                // 1. Filter out the uploader
                const adminIdsToNotify = adminIds
                    .map((id) => id.toString())
                    .filter((id) => id !== String(userId));

                if (adminIdsToNotify.length > 0) {
                    // 2. Prepare the notification content
                    const fileCount = Array.isArray(files) ? files.length : 1;
                    const prettyType = type.charAt(0)?.toUpperCase() + type.slice(1         );
                    const title = `New ${prettyType} uploaded`            ;
                    const body = `${fileCount} file${fileCount > 1 ? 's' : ''
                        } uploaded for enquiry "${enquiry.Name || enquiry._id}"${version ? ` (version ${version})` : ''
                        }.`;
                    const link = `enquiries/${enquiry._id.toString()}`; // Mobile app format

                    // 3. Call the new service (replaces the entire old block)
                    await notificationService.createAlertsForUsers(
                        adminIdsToNotify,
                        title,
                        body,
                        'asset_upload', // The type
                        link
                    );
                } else {
                }
            }
        } else {
        }
    } catch (err) {
    }

    // 3) return upload result to caller
    return uploadResult;
};


exports.updateAssetData = async (enquiryId, type, version, data, userId) => {
    const enquiry = await repo.getEnquiryById(enquiryId);
    if (!enquiry) throw new Error('Enquiry not found');
    switch (type) {
        case 'coral':
            let coralIndex = enquiry.Coral.findIndex(a => a.Version === version);
            if (coralIndex !== -1) {
                const updatedCoral = enquiry.Coral[coralIndex];

                if (data.IsApprovedVersion !== undefined && data.IsApprovedVersion !== null) {
                    updatedCoral.IsApprovedVersion = data.IsApprovedVersion;
                    if (data.IsApprovedVersion === true) {
                        // Coral approved → CAD phase begins; a designer must be assigned to make the CAD.
                        updatedCoral.ReasonForRejection = data.ReasonForRejection || "";
                        appendStatusEntry(enquiry, {
                            status: 'Cad',
                            subStatus: deriveSubStatus('Cad', { assignedTo: null }),
                            assignedTo: null,
                            addedBy: userId,
                            details: "Coral Approved - " + (data.ReasonForRejection ?? ""),
                        });
                    } else {
                        updatedCoral.ReasonForRejection = data.ReasonForRejection || "";
                        appendStatusEntry(enquiry, {
                            status: 'Coral',
                            subStatus: 'Rejected - Redo',
                            addedBy: userId,
                            details: "Coral Rejected - " + data.ReasonForRejection ?? "",
                        });
                    }
                }

                if (data.Pricing !== undefined && data.Pricing !== null) {
                    updatedCoral.Pricing = data.Pricing;
                    appendStatusEntry(enquiry, {
                        status: enquiry.StatusHistory?.at(-1)?.Status,
                        subStatus: deriveCostSubStatus(updatedCoral),
                        addedBy: userId,
                        details: "Coral Pricing Updated",
                    });
                }

                if (data.SendForApproval === true) {
                    appendStatusEntry(enquiry, {
                        status: 'Design Approval Pending',
                        subStatus: null,
                        addedBy: userId,
                        details: "Sent for design approval",
                    });
                }

                if (data.CoralCode !== undefined && data.CoralCode !== null) {
                    updatedCoral.CoralCode = data.CoralCode;
                }

                if (data.Cost !== undefined && data.Cost !== null && data.Cost !== '') {
                    const parsedCost = Number(data.Cost);
                    if (Number.isNaN(parsedCost)) throw new Error('Cost must be a valid number');
                    updatedCoral.Cost = parsedCost;
                }

                if (data.IsOnlyMetalDesign !== undefined && data.IsOnlyMetalDesign !== null) {
                    updatedCoral.IsOnlyMetalDesign = data.IsOnlyMetalDesign;
                }

                if (data.Description && data.Id) {
                    updatedCoral.Images = updatedCoral.Images.map(image => {
                        if (image.Id === data.Id) {
                            return { ...image, Description: data.Description };
                        }
                        return image;
                    });
                }

                if (data.Delete === true) {
                    if (data.Id) {
                        updatedCoral.Images = updatedCoral.Images.filter(image => image.Id !== data.Id);
                    } else {
                        //delete entire version
                        enquiry.Coral.splice(coralIndex, 1);
                        // Move status back to in progress because in 10 mins designer deleted it
                        appendStatusEntry(enquiry, {
                            status: 'Coral',
                            subStatus: 'Assigned',
                            addedBy: userId,
                            details: "Coral Version Deleted",
                        });
                    }
                }

                // Replace the item at the found index only if not deleting entire version
                if (!(data.Delete === true && !data.Id)) {
                    enquiry.Coral[coralIndex] = updatedCoral;
                }
            }
            else {
                throw new Error('Version not found in Coral');
            }
            break;
        case 'cad':
            let cadIndex = enquiry.Cad.findIndex(a => a.Version === version);
            if (cadIndex !== -1) {
                const updatedCad = enquiry.Cad[cadIndex];

                // Step 1: Admin approves first CAD design → designer must upload Final CAD
                if (data.IsApprovedVersion !== undefined && data.IsApprovedVersion !== null) {
                    updatedCad.IsApprovedVersion = data.IsApprovedVersion;
                    if (data.IsApprovedVersion === true) {
                        updatedCad.ReasonForRejection = data.ReasonForRejection || "";
                        appendStatusEntry(enquiry, {
                            status: 'Cad',
                            subStatus: 'Final Cad Upload',
                            addedBy: userId,
                            details: "Cad Design Approved - Final CAD required -" + (data.ReasonForRejection ?? ""),
                        });
                    } else {
                        updatedCad.ReasonForRejection = data.ReasonForRejection || "";
                        appendStatusEntry(enquiry, {
                            status: 'Cad',
                            subStatus: 'Rejected - Redo',
                            addedBy: userId,
                            details: "Cad Rejected - " + (data.ReasonForRejection ?? ""),
                        });
                    }
                }

                // Step 2: Designer marks uploaded CAD as the final version → Order Placement
                if (data.IsFinalVersion !== undefined && data.IsFinalVersion !== null) {
                    updatedCad.IsFinalVersion = data.IsFinalVersion;
                    if (data.IsFinalVersion === true) {
                        appendStatusEntry(enquiry, {
                            status: 'Order Placement',
                            subStatus: null,
                            assignedTo: null,
                            addedBy: userId,
                            details: "Final Cad Approved",
                        });
                    }
                }

                if (data.Pricing !== undefined && data.Pricing !== null) {
                    updatedCad.Pricing = data.Pricing;
                    appendStatusEntry(enquiry, {
                        status: enquiry.StatusHistory?.at(-1)?.Status,
                        subStatus: deriveCostSubStatus(updatedCad),
                        addedBy: userId,
                        details: "Cad Pricing Updated",
                    });
                }

                if (data.CadCode !== undefined && data.CadCode !== null) {
                    updatedCad.CadCode = data.CadCode;
                }

                if (data.Cost !== undefined && data.Cost !== null && data.Cost !== '') {
                    const parsedCost = Number(data.Cost);
                    if (Number.isNaN(parsedCost)) throw new Error('Cost must be a valid number');
                    updatedCad.Cost = parsedCost;
                }

                if (data.IsOnlyMetalDesign !== undefined && data.IsOnlyMetalDesign !== null) {
                    updatedCad.IsOnlyMetalDesign = data.IsOnlyMetalDesign;
                }

                if (data.SendForApproval === true) {
                    appendStatusEntry(enquiry, {
                        status: 'Design Approval Pending',
                        subStatus: null,
                        addedBy: userId,
                        details: "Sent for design approval",
                    });
                }

                if (data.Description && data.Id) {
                    updatedCad.Images = updatedCad.Images.map(image => {
                        if (image.Id === data.Id) {
                            return { ...image, Description: data.Description };
                        }
                        return image;
                    });
                }

                if (data.Delete === true) {
                    if (data.Id) {
                        updatedCad.Images = updatedCad.Images.filter(image => image.Id !== data.Id);
                    } else {
                        //delete entire version
                        enquiry.Cad.splice(cadIndex, 1);
                        appendStatusEntry(enquiry, {
                            status: 'Cad',
                            subStatus: 'Assigned',
                            addedBy: userId,
                            details: "Cad Version Deleted",
                        });
                    }
                }

                // Replace the item at the found index only if not deleting entire version
                if (!(data.Delete === true && !data.Id)) {
                    enquiry.Cad[cadIndex] = updatedCad;
                }
            }
            else {
                throw new Error('Version not found in Cad');
            }
            break;
        case 'reference':
            if (!enquiry.ReferenceImages) {
                break;
            }
            if (data.Description && data.Id) {
                enquiry.ReferenceImages = enquiry.ReferenceImages.map(image => {
                    if (image.Id === data.Id) {
                        return { ...image, Description: data.Description };
                    }
                    return image;
                });
            }
            break;
        default:
            throw new Error('Invalid asset type');
    }

    // Save the updated enquiry
    return await repo.updateEnquiry(enquiryId, enquiry);
};


// Extract the design geometry once, then price it for every metal quality and stone type
// the enquiry asks for, so Coral/Cad.Pricing holds one entry per quality/type pair.
function toNameList(value) {
    const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return [...new Set(raw.map(item => String(item ?? '').trim()).filter(Boolean))];
}

async function priceUploadedStones(tableJson, enquiry, clientId, isOnlyMetalDesign) {
    const types = toNameList(enquiry.StoneTypes);

    const fromQualities = toNameList(enquiry.Metal?.Qualities);
    const qualities = fromQualities.length
        ? fromQualities
        : toNameList(enquiry.Metal?.Quality);

    if (!qualities.length) return null;
    if (!isOnlyMetalDesign && !types.length) return null;

    const metalWeight = tableJson.Metal?.Weight || 0;
    tableJson.Quantity = enquiry.Quantity || 1;

    const refs = await loadPricingRefs(clientId);

    const pricing = [];
    for (const quality of qualities) {
        const base = { ...tableJson, Metal: { Weight: metalWeight, Quality: quality } };

        if (isOnlyMetalDesign) {
            pricing.push(await exports.calculatePricing({ ...base, Stones: [] }, clientId, true, false, '', refs));
            continue;
        }

        for (const type of types) {
            pricing.push(await exports.calculatePricing({
                ...base,
                Stones: (tableJson.Stones || []).map(stone => ({ ...stone, Type: type, Markup: 0 })),
            }, clientId, false, false, '', refs));
        }
    }
    return pricing;
}


async function handleCoralUpload(enquiry, files, version, coralCode, userId, cost, isOnlyMetalDesign = false) {

    const assetVersion = version || 'Version 1';
    let asset = enquiry.Coral.find(a => a.Version === assetVersion);

    if (!asset) {
        asset = {
            Version: assetVersion,
            Images: [],
            Excel: null,
            Pricing: null,
            CoralCode: coralCode || '',
            Cost: cost,
            IsOnlyMetalDesign: isOnlyMetalDesign,
            IsApprovedVersion: false
        };
    } else {
        if (cost !== undefined) asset.Cost = cost;
        if (isOnlyMetalDesign) asset.IsOnlyMetalDesign = true;
    }

    

    const newCoralUploads = [];
    if (files.images) {
        for (const file of files.images) {
            const key = await uploadToS3(file);
            asset.Images.push({
                Id: uuidv4(),
                Key: key,
                Description: file.originalname
            });
            newCoralUploads.push({ key, mimetype: file.mimetype });
        }
    }

    let tableJson = null;

    if (files.excel?.length > 0) {
        const excelFile = files.excel[0];
        const key = await uploadToS3(excelFile);
        asset.Excel = {
            Id: uuidv4(),
            Key: key,
            Description: excelFile.originalname
        };
        tableJson = await handleExcelDataForCoral(excelFile);
    } else if (files.images?.length > 0) {
        try {
            tableJson = await extractPricingDataFromImage(files.images[0].buffer, files.images[0].mimetype);
        } catch (err) {
            console.error('[handleCoralUpload] LLM extraction failed, skipping pricing:', err);
        }
    }

    if (tableJson) {
        const priced = await priceUploadedStones(tableJson, enquiry, enquiry.ClientId, asset.IsOnlyMetalDesign);

        if (Array.isArray(priced) && priced.length) {
            asset.Pricing = priced.map(pricing => ({
                MetalPrice: +pricing.MetalPrice,
                DiamondsPrice: +pricing.DiamondsPrice,
                TotalPrice: +pricing.TotalPrice,
                DutiesAmount: +pricing.DutiesAmount,
                DiamondWeight: pricing.DiamondWeight,
                TotalPieces: tableJson.TotalPieces,
                Loss: pricing.Client.Loss,
                Labour: pricing.Client.Labour,
                ExtraCharges: pricing.Client.ExtraCharges,
                UndercutPrice: pricing.Client.UndercutPrice,
                NaturalDuties: pricing.Client.NaturalDuties,
                LabDuties: pricing.Client.LabDuties,
                GoldDuties: pricing.Client.GoldDuties,
                SilverAndLabsDuties: pricing.Client.SilverAndLabsDuties,
                LossAndLabourDuties: pricing.Client.LossAndLabourDuties,
                ClientPricingMessage: pricing.ClientPricingMessage || null,
                Metal: {
                    Weight: pricing.Metal.Weight,
                    Quality: pricing.Metal.Quality,
                    Rate: pricing.Metal.Rate
                },
                Stones: (pricing.Stones || []).map(stone => ({
                    Type: stone.Type,
                    Color: stone.Color,
                    Shape: stone.Shape,
                    MmSize: stone.MmSize,
                    SieveSize: stone.SieveSize,
                    Weight: stone.Weight,
                    Pcs: stone.Pcs,
                    CtWeight: stone.CtWeight,
                    Price: stone.Price,
                    Markup: stone.Markup || 0
                }))
            }));
        }
    }

    // Push to the Coral array
    enquiry.Coral = enquiry.Coral || [];

    const index = enquiry.Coral.findIndex(a => a.Version === assetVersion);
    if (index !== -1) {
        enquiry.Coral[index] = asset;
    } else {
        enquiry.Coral.push(asset);
    }

    appendStatusEntry(enquiry, {
        status: 'Coral',
        subStatus: deriveCostSubStatus(asset),
        addedBy: userId,
        details: `Coral Version ${asset.Version} uploaded`,
    });

    const updateResult = await repo.updateEnquiry(enquiry._id, enquiry);

    if (newCoralUploads.length) {
        const coralStones = tableJson?.Stones || [];
        const coralMetal = tableJson?.Metal || null;
        // queueMicrotask(() => indexUploadedAssets({
        //     enquiryId: enquiry._id, type: 'coral', version: assetVersion, uploads: newCoralUploads,
        //     stones: coralStones, metal: coralMetal, isOnlyMetalDesign: asset.IsOnlyMetalDesign,
        // }));
    }

    return { _id: enquiry._id };
}

async function handleCadUpload(enquiry, files, version, cadCode, userId, cost, isFinalVersion = false, isOnlyMetalDesign = false) {
    const assetVersion = version || 'Version 1';
    let asset = enquiry.Cad.find(a => a.Version === assetVersion);

    if (!asset) {
        asset = {
            Version: assetVersion,
            Images: [],
            Excel: null,
            Pricing: null,
            CadCode: cadCode || '',
            Cost: cost,
            IsOnlyMetalDesign: isOnlyMetalDesign,
            IsFinalVersion: isFinalVersion
        };
    } else {
        if (cost !== undefined) asset.Cost = cost;
        if (isFinalVersion) asset.IsFinalVersion = true;
        if (isOnlyMetalDesign) asset.IsOnlyMetalDesign = true;
    }

    const newCadUploads = [];
    if (files.images) {
        for (const file of files.images) {
            const key = await uploadToS3(file);
            asset.Images.push({
                Id: uuidv4(),
                Key: key,
                Description: file.originalname
            });
            newCadUploads.push({ key, mimetype: file.mimetype });
        }
    }

    let tableJson = null;

    if (files.excel?.length > 0) {
        const excelFile = files.excel[0];
        const key = await uploadToS3(excelFile);
        asset.Excel = {
            Id: uuidv4(),
            Key: key,
            Description: excelFile.originalname
        };
        tableJson = await handleExcelDataForCad(excelFile);
    } else if (files.images?.length > 0) {
        const { extractPricingDataFromImage } = require('./imagePricing.service');
        try {
            tableJson = await extractPricingDataFromImage(files.images[0].buffer, files.images[0].mimetype);
        } catch (err) {
            console.error('[handleCadUpload] LLM extraction failed, skipping pricing:', err);
        }
    }

    if (tableJson) {
        const priced = await priceUploadedStones(tableJson, enquiry, enquiry.ClientId, asset.IsOnlyMetalDesign);

        if (Array.isArray(priced) && priced.length) {
            asset.Pricing = priced.map(pricing => ({
                MetalPrice: +pricing.MetalPrice,
                DiamondsPrice: +pricing.DiamondsPrice,
                TotalPrice: +pricing.TotalPrice,
                DutiesAmount: +pricing.DutiesAmount,
                DiamondWeight: pricing.DiamondWeight,
                TotalPieces: tableJson.TotalPieces,
                Loss: pricing.Client.Loss,
                Labour: pricing.Client.Labour,
                ExtraCharges: pricing.Client.ExtraCharges,
                UndercutPrice: pricing.Client.UndercutPrice,
                NaturalDuties: pricing.Client.NaturalDuties,
                LabDuties: pricing.Client.LabDuties,
                GoldDuties: pricing.Client.GoldDuties,
                SilverAndLabsDuties: pricing.Client.SilverAndLabsDuties,
                LossAndLabourDuties: pricing.Client.LossAndLabourDuties,
                ClientPricingMessage: pricing.ClientPricingMessage || null,
                Metal: {
                    Weight: pricing.Metal.Weight,
                    Quality: pricing.Metal.Quality,
                    Rate: pricing.Metal.Rate
                },
                Stones: (pricing.Stones || []).map(stone => ({
                    Type: stone.Type,
                    Color: stone.Color,
                    Shape: stone.Shape,
                    MmSize: stone.MmSize,
                    SieveSize: stone.SieveSize,
                    Weight: stone.Weight,
                    Pcs: stone.Pcs,
                    CtWeight: stone.CtWeight,
                    Price: stone.Price,
                    Markup: stone.Markup || 0
                }))
            }));
        }
    }

    // Push to the Cad array
    const index = enquiry.Cad.findIndex(a => a.Version === assetVersion);
    if (index !== -1) {
        enquiry.Cad[index] = asset;
    } else {
        enquiry.Cad.push(asset);
    }

    appendStatusEntry(enquiry, {
        status: isFinalVersion? 'Order Placement' : 'Cad',
        subStatus: isFinalVersion ? null : deriveCostSubStatus(asset),
        addedBy: userId,
        details: `CAD Version ${isFinalVersion ? 'Final' : asset.Version} uploaded`,
    });

    const updateResult = await repo.updateEnquiry(enquiry._id, enquiry);

    if (newCadUploads.length) {
        const cadStones = tableJson?.Stones || [];
        const cadMetal = tableJson?.Metal || null;
        // queueMicrotask(() => indexUploadedAssets({
        //     enquiryId: enquiry._id, type: 'cad', version: assetVersion, uploads: newCadUploads,
        //     stones: cadStones, metal: cadMetal, isOnlyMetalDesign: asset.IsOnlyMetalDesign,
        // }));
    }

    return { _id: enquiry._id };
}

async function handleReferenceImageUpload(enquiry, files, userId) {

    enquiry.ReferenceImages = enquiry.ReferenceImages || [];

    if (files.images) {
        for (const file of files.images) {
            const key = await uploadToS3(file);
            enquiry.ReferenceImages.push({
                Id: uuidv4(),
                Key: key,
                Description: file.description || file.originalname
            });
        }
    }
    
    const lastEntry = enquiry.StatusHistory.at(-1);
    appendStatusEntry(enquiry, {
        status: lastEntry?.Status,
        subStatus: lastEntry?.SubStatus ?? null,
        addedBy: userId,
        details: 'Reference images uploaded',
    });

    await repo.updateEnquiry(enquiry._id, enquiry);
    return { _id: enquiry._id };
}

async function handleExcelDataForCoral(file) {
    if (!file || !file.buffer) {
        return;
    }
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    let stones = [];
    let diamondWeight = null;
    let metalWeight = null;
    let totalPieces = 0;

    for (const row of jsonData) {
        const Color = row['DIA/COL']?.toString()?.trim();
        const Shape = normalizeShape(row['ST SHAPE']?.toString()?.trim());
        const MmSize = row['MM SIZE']?.toString()?.trim();
        const SieveSize = row['SIEVE SIZE']?.toString()?.trim();
        const Weight = parseFloat(row['AVRG WT']) || 0;
        const Pcs = parseInt(row['PCS']) || 0;
        const CtWeight = row['CT WT'] ? Math.trunc(parseFloat(row['CT WT']) * 1000) / 1000 : 0;

        // Accumulate total pieces
        totalPieces += Pcs;

        // If it's a valid stone row (with settingType or shape), include it
        if (Shape) {
            stones.push({
                Color,
                Shape,
                MmSize,
                SieveSize,
                Weight,
                Pcs,
                CtWeight
            });
        }

        // Extract goldWeight if present
        if (!metalWeight && row['METAL WEIGHT']) {
            metalWeight = row['METAL WEIGHT'].toString()?.trim();
        }

        // Extract diamondWeight if present (optional)
        if (!diamondWeight && row['T.DIA WT']) {
            diamondWeight = row['T.DIA WT'].toString()?.trim();
        }
    }


    return {
        Stones: stones,
        DiamondWeight: diamondWeight,
        Metal: {
            Weight: metalWeight,
        },
        TotalPieces: totalPieces
    };
}

async function handleExcelDataForCad(file) {
    if (!file || !file.buffer) {
        return;
    }
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    let stones = [];
    let diamondWeight = 0;
    let metalWeight = 0;
    let totalPieces = 0;

    for (const row of jsonData) {
        const Color = row['DIA/COL']?.toString()?.trim();
        const Shape = normalizeShape(row['ST SHAPE']?.toString()?.trim() || '');
        const MmSize = row['MM SIZE']?.toString()?.trim();
        const SieveSize = row['SIEVE SIZE']?.toString()?.trim().match(/[\d.]+(?:-[\d.]+)?/)?.[0] || '';
        const Weight = parseFloat(row['AVRG WT']) || 0;
        const Pcs = parseInt(row['PCS']) || 0;
        const CtWeight = row['CT WT'] ? Math.trunc(parseFloat(row['CT WT']) * 1000) / 1000 : 0;

        // Accumulate total pieces
        totalPieces += Pcs;
        
        // Extract goldWeight if present
        if (!metalWeight && row['METAL WEIGHT']) {
            metalWeight = row['METAL WEIGHT'].toString()?.trim();
        }

        // Extract diamondWeight if present (optional)
        if ((diamondWeight == null || diamondWeight === '') && row['T.DIA WT'] != null) {
            const raw = row['T.DIA WT'].toString().trim();
            const parsed = parseFloat(raw);
            diamondWeight = Number.isFinite(parsed) ? parsed : null;
        }


        // If it's a valid stone row (with shape), include it
        if (Shape) {
            stones.push({
                Color,
                Shape,
                MmSize,
                SieveSize,
                Weight,
                Pcs,
                CtWeight
            });
        }
    }


    return {
        Stones: stones,
        DiamondWeight: diamondWeight?.toFixed(3),
        Metal: {
            Weight: metalWeight?.toFixed(3),
        },
        TotalPieces: totalPieces
    };
}

exports.searchEnquiries = async (queryParams, userId) => {
    const scopedParams = await scopeClientFilter(queryParams, userId);
    return await searchEnquiriesInternal(scopedParams);
};

exports.getAggregatedCounts = async (queryParams, userId) => {
    const scopedParams = await scopeClientFilter(queryParams, userId);

   
    const { groupBy, ...filters } = scopedParams;


    if (!groupBy) {
        throw new Error("Missing 'groupBy' query parameter. Try 'status', 'client', or 'buckets'.");
    }
    const allowedTypes = ['status', 'client', 'buckets'];
    if (!allowedTypes.includes(groupBy)) {
        throw new Error("Invalid aggregation type. Must be one of: " + allowedTypes.join(', '));
    }

 
    return await repo.aggregateBy(groupBy, filters);
};

exports.calculatePricing = pricingCalculate;


exports.massActionEnquiries = async ({ enquiryIds, updateType, newStatus, userId }) => {

    if (!enquiryIds?.length) {
        throw new Error("enquiryIds is required");
    }

    switch (updateType) {

        case "status":
            if (!newStatus) {
                throw new Error("newStatus is required when updateType = status");
            }

            return repo.bulkAppendStatus(enquiryIds, {
                Status: newStatus,
                AddedBy: userId
            });

        case "delete":
            const results = [];

            for (const id of enquiryIds) {
                const result = await this.deleteEnquiry(id);
                results.push({ id, result });
            }

            return {
                deletedCount: results.length,
                results
            };

        default:
            throw new Error("Invalid updateType");
    }
};

exports.exportEnquiriesPdf = async (queryParams, userId) => {
    const startTime = Date.now();
    const scopedQuery = await scopeClientFilter(queryParams || {}, userId);
    const { reportType = 'enquiries-list', ...userParams } = scopedQuery;
    const format = reportsService.getFormat(reportType);


    const mergedParams = { ...userParams, ...(format.baseFilters || {}) };


    if (format.defaultSort && !mergedParams.sortBy) {
        mergedParams.sortBy    = format.defaultSort.field;
        mergedParams.sortOrder = format.defaultSort.order;
    }

    console.log(`[PDF Export] reportType=${format.id} filters=`, mergedParams);

    const data = await searchEnquiriesInternal(mergedParams, { noPaging: true });
    console.log(`[PDF Export] Fetched ${data.data?.length || 0} enquiries in ${Date.now() - startTime}ms`);

    return reportsService.buildReport(format.id, data.data);
};

async function searchEnquiriesInternal(queryParams, options = {}) {
    // --- 1. Prepare Pagination ---
    const page = parseInt(queryParams.page, 10) || 1;
    const limit = parseInt(queryParams.limit, 10) || 25;
    const pagination = options.noPaging ? {
        skip: 0,
        // For PDF exports, allow up to 10000 records (was 1000)
        limit: Math.min(parseInt(queryParams.limit, 10) || 10000, 10000)
    } : {
        skip: (page - 1) * limit,
        limit: limit
    };


    const sortBy = queryParams.sortBy || 'AssignedDate';
    const sortOrder = queryParams.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortBy]: sortOrder };


    const searchTerm = queryParams.search || null;

    const reservedKeys = ['page', 'limit', 'sortBy', 'sortOrder', 'search'];
    const filters = {};
    for (const key in queryParams) {

        if (!reservedKeys.includes(key) && queryParams[key]) {
            filters[key] = queryParams[key];
        }
    }

    const result = await repo.search(searchTerm, filters, sort, pagination);

    return {
        ...result,
        page,
        limit
    };
};


exports.getPresignedUrl = async (key, action) => {
    return await generatePresignedUrl(key, action);
};
