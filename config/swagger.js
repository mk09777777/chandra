const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Chandra Workflow API',
        version: '1.0.0',
        description: 'Backend API for the Chandra jewellery workflow management system.',
    },
    servers: process.env.NODE_ENV === 'production'
        ? [
            { url: 'https://workflowapi-quhn.onrender.com', description: 'Production' },
            { url: `http://localhost:${process.env.PORT || 3000}`, description: 'Local' },
          ]
        : [
            { url: `http://localhost:${process.env.PORT || 3000}`, description: 'Local' },
            { url: 'https://workflowapi-quhn.onrender.com', description: 'Production' },
          ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
        },
        schemas: {
            // ── Auth ────────────────────────────────────────────────────────
            LoginRequest: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email:    { type: 'string', format: 'email' },
                    password: { type: 'string' },
                },
            },
            LoginResponse: {
                type: 'object',
                properties: {
                    token: { type: 'string' },
                },
            },

            // ── Client ──────────────────────────────────────────────────────
            Client: {
                type: 'object',
                properties: {
                    _id:           { type: 'string' },
                    Name:          { type: 'string' },
                    ImageUrl:      { type: 'string' },
                    PriorityOrder: { type: 'number', description: 'Lower number = higher priority client' },
                    Pricing: {
                        type: 'object',
                        properties: {
                            Loss:                { type: 'number' },
                            Labour:              { type: 'number' },
                            ExtraCharges: {
                                type: 'object',
                                properties: {
                                    Type:  { type: 'string', enum: ['percentage', 'fixed'] },
                                    Value: { type: 'number' },
                                },
                                description: 'Extra charge applied to the total — either a percentage or a fixed amount.',
                            },
                            NaturalDuties:       { type: 'number', description: 'Duty % on natural diamond value' },
                            LabDuties:           { type: 'number', description: 'Duty % on lab diamond value (when metal is gold)' },
                            GoldDuties:          { type: 'number', description: 'Duty % on gold metal value' },
                            SilverAndLabsDuties: { type: 'number', description: 'Flat duty % on silver-metal + lab-stone combined base' },
                            LossAndLabourDuties: { type: 'number', description: 'Duty % applied to the loss + labour portion of the metal price' },
                            UndercutPrice:       { type: 'number', description: 'Per-carat cap used as the duty base when applied' },
                            Diamonds: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        Type:     { type: 'string' },
                                        Shape:    { type: 'string' },
                                        Carat:    { type: 'number' },
                                        MmSize:   { type: 'string' },
                                        SieveSize:{ type: 'string' },
                                        Price:    { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                    PricingMessageFormat: {
                        type: 'string',
                        description: 'Template string used to format the client-facing pricing message.',
                    },
                    ApplicableStoneTypes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Stone types this client supports (from the StoneTypes codelist). Case-insensitive on input and canonicalized on store; unknown values are kept as sent. Limits the jewelry-estimator price matrix to these types.',
                    },
                },
            },

            // ── User ────────────────────────────────────────────────────────
            User: {
                type: 'object',
                properties: {
                    Id:       { type: 'string' },
                    Name:     { type: 'string' },
                    Role:     { type: 'number' },
                    Skills:   { type: 'string' },
                    email:    { type: 'string', format: 'email' },
                    phone:    { type: 'string' },
                    clientId: { type: 'string', description: 'Set for client-role users' },
                    group:    { type: 'string', enum: ['Bridal', 'Hip-hop', 'Cuban'], description: 'Designer specialisation group' },
                },
            },
            UserSummary: {
                type: 'object',
                description: 'Slim user shape returned by the list endpoint (no email/phone/clientId).',
                properties: {
                    Id:     { type: 'string' },
                    Name:   { type: 'string' },
                    Role:   { type: 'number' },
                    Skills: { type: 'string' },
                    group:  { type: 'string', enum: ['Bridal', 'Hip-hop', 'Cuban'] },
                },
            },

            // ── Metal Prices ────────────────────────────────────────────────
            MetalPrice: {
                type: 'object',
                properties: {
                    _id:   { type: 'string' },
                    metal: { type: 'string', example: 'gold' },
                    price: { type: 'number' },
                    date:  { type: 'string', format: 'date-time' },
                },
            },

            // ── Enquiry Checklist ───────────────────────────────────────────
            EnquiryChecklist: {
                type: 'object',
                description: 'Auto-generated jewelry manufacturing checklist extracted from Remarks / SpecialRemarks via Gemini. Populated asynchronously after create/update (fire-and-forget). Fields not mentioned by the customer are returned as the string "NA".',
                nullable: true,
                properties: {
                    Engraving:           { type: 'string', example: 'NA' },
                    SizeLength:          { type: 'string', example: 'NA' },
                    SizeRingSize:        { type: 'string', example: 'NA' },
                    DimensionsThickness: { type: 'string', example: 'NA' },
                    DeliveryDate:        { type: 'string', example: 'NA' },
                    EnamelPaintwork:     { type: 'string', example: 'NA' },
                    RhodiumInstructions: { type: 'string', example: 'NA' },
                    Components:          { type: 'string', example: 'NA' },
                    Findings:            { type: 'string', example: 'NA', description: 'A single finding from the customer message, e.g. "Chain - Medium", "Nutpost", "Lock - Handmade". "NA" if not mentioned.' },
                    GeneratedAt:         { type: 'string', format: 'date-time', description: 'When the checklist was last regenerated' },
                },
            },

            // ── Enquiry ─────────────────────────────────────────────────────
            EnquiryBase: {
                type: 'object',
                properties: {
                    Name:            { type: 'string' },
                    Quantity:        { type: 'number' },
                    StyleNumber:     { type: 'string' },
                    GatiOrderNumber: { type: 'string' },
                    ClientId:        { type: 'string' },
                    Priority:        { type: 'string', enum: ['Low', 'Medium', 'High', 'Urgent'] },
                    Category:        { type: 'string' },
                    StoneType:       { type: 'string' },
                    Metal: {
                        type: 'object',
                        properties: {
                            Color:   { type: 'string' },
                            Quality: { type: 'string' },
                        },
                    },
                    MetalWeight: {
                        type: 'object',
                        properties: {
                            From:  { type: 'number' },
                            To:    { type: 'number' },
                            Exact: { type: 'number' },
                        },
                    },
                    DiamondWeight: {
                        type: 'object',
                        properties: {
                            From:  { type: 'number' },
                            To:    { type: 'number' },
                            Exact: { type: 'number' },
                        },
                    },
                    Stamping:        { type: 'string' },
                    Remarks:         { type: 'string' },
                    SpecialRemarks:  { type: 'string' },
                    Budget:          { type: 'string' },
                    ShippingDate:    { type: 'string', format: 'date-time' },
                },
            },
            Enquiry: {
                allOf: [
                    { $ref: '#/components/schemas/EnquiryBase' },
                    {
                        type: 'object',
                        properties: {
                            _id: { type: 'string' },
                            StatusHistory: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        Status:     { type: 'string' },
                                        SubStatus:  { type: 'string', nullable: true, description: 'L2 stage within the Coral/Cad phase: Assign Pending, Assigned, Rejected - Redo, Design Submitted, Cost Missing, Quotation Review. Null outside Coral/Cad.' },
                                        Timestamp:  { type: 'string', format: 'date-time' },
                                        AssignedTo: { type: 'string' },
                                        Details:    { type: 'string' },
                                        AddedBy:    { type: 'string' },
                                    },
                                },
                            },
                            ReferenceImages: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        Id:          { type: 'string' },
                                        Key:         { type: 'string' },
                                        Description: { type: 'string' },
                                        MimeType:    { type: 'string' },
                                    },
                                },
                            },
                            SimilarDesigns: {
                                type: 'array',
                                description: 'Top similar past designs (populated asynchronously after create).',
                                items: {
                                    type: 'object',
                                    properties: {
                                        EnquiryId: { type: 'string' },
                                        Key:       { type: 'string' },
                                        Score:     { type: 'number' },
                                    },
                                },
                            },
                            Coral: { type: 'array', items: { $ref: '#/components/schemas/CoralVersion' } },
                            Cad:   { type: 'array', items: { $ref: '#/components/schemas/CadVersion' } },
                            Checklist: { $ref: '#/components/schemas/EnquiryChecklist' },
                            Summary: { type: 'string', nullable: true, description: 'AI-generated designer-facing Markdown summary of the enquiry. Populated asynchronously by Gemini after every POST / PUT — refetch the enquiry to see it.' },
                        },
                    },
                ],
            },
            VersionMarker: {
                type: 'object',
                nullable: true,
                description: 'High-level marker for a Coral/CAD version returned in search — the Version label plus its rejection reason (if any). Absent when that version does not exist.',
                properties: {
                    Version:            { type: 'string', example: 'Version 2' },
                    ReasonForRejection: { type: 'string', nullable: true, description: 'Set when this version was rejected; empty/absent otherwise.' },
                },
            },
            EnquirySearchItem: {
                type: 'object',
                description: 'A row returned by GET /api/enquiries/search. This is a PROJECTED, computed shape — not the full Enquiry document. Status/assignment fields are derived from the last StatusHistory entry; ReferenceImages is the resolved display image set; version markers carry only Version.',
                properties: {
                    _id:              { type: 'string' },
                    Name:             { type: 'string' },
                    StyleNumber:      { type: 'string' },
                    Category:         { type: 'string' },
                    CurrentStatus:    { type: 'string', description: 'Status of the last StatusHistory entry' },
                    CurrentSubStatus: { type: 'string', nullable: true, description: 'SubStatus of the last StatusHistory entry (L2 within Coral/Cad; null otherwise)' },
                    ClientId:         { type: 'string' },
                    AssignedTo:       { type: 'string', nullable: true, description: 'Assignee on the last StatusHistory entry' },
                    AssignedDate:     { type: 'string', format: 'date-time', description: 'Timestamp of the last StatusHistory entry' },
                    CreatedDate:      { type: 'string', format: 'date-time', description: 'Timestamp of the first StatusHistory entry' },
                    Priority:         { type: 'string', enum: ['Normal', 'High', 'Super High'] },
                    Metal:            { type: 'object', properties: { Color: { type: 'string' }, Quality: { type: 'string' } } },
                    StoneType:        { type: 'string' },
                    ShippingDate:     { type: 'string', format: 'date-time', nullable: true },
                    Remarks:          { type: 'string' },
                    SpecialRemarks:   { type: 'string' },
                    Checklist:        { $ref: '#/components/schemas/EnquiryChecklist' },
                    Summary:          { type: 'string', nullable: true },
                    LatestQuotation:  { type: 'string', nullable: true, description: 'Most recent ClientPricingMessage — latest CAD version, falling back to latest Coral version.' },
                    ReferenceImages:  { type: 'array', description: 'Resolved display images (finalCad → lastCad → approvedCoral → lastCoral → reference images).', items: { $ref: '#/components/schemas/AssetImage' } },
                    lastCoral:        { $ref: '#/components/schemas/VersionMarker' },
                    approvedCoral:    { $ref: '#/components/schemas/VersionMarker' },
                    lastCad:          { $ref: '#/components/schemas/VersionMarker' },
                    approvedCad:      { $ref: '#/components/schemas/VersionMarker' },
                    finalCad:         { $ref: '#/components/schemas/VersionMarker' },
                },
            },
            AssetImage: {
                type: 'object',
                description: 'A Coral or CAD image attached to a version.',
                properties: {
                    Id:          { type: 'string' },
                    Key:         { type: 'string', description: 'S3 key' },
                    Description: { type: 'string' },
                },
            },
            AssetExcel: {
                type: 'object',
                description: 'A Coral or CAD excel attached to a version.',
                properties: {
                    Id:          { type: 'string' },
                    Key:         { type: 'string', description: 'S3 key' },
                    Description: { type: 'string' },
                },
            },
            PricingSnapshot: {
                type: 'object',
                description: 'A pricing record persisted on a Coral or CAD version. Captures both the computed totals and the rate/charge snapshot that was applied at quote time.',
                properties: {
                    MetalPrice:           { type: 'number' },
                    DiamondsPrice:        { type: 'number' },
                    TotalPrice:           { type: 'number' },
                    DutiesAmount:         { type: 'number', description: 'Sum of all duty buckets applied to this quote' },
                    NaturalDuties:        { type: 'number', description: 'Rate % applied at quote time' },
                    LabDuties:            { type: 'number' },
                    GoldDuties:           { type: 'number' },
                    SilverAndLabsDuties:  { type: 'number' },
                    LossAndLabourDuties:  { type: 'number' },
                    Loss:                 { type: 'number' },
                    Labour:               { type: 'number' },
                    ExtraCharges: {
                        type: 'object',
                        properties: {
                            Type:  { type: 'string', enum: ['percentage', 'fixed'] },
                            Value: { type: 'number' },
                        },
                    },
                    UndercutPrice:        { type: 'number' },
                    DiamondWeight:        { type: 'number' },
                    TotalPieces:          { type: 'number' },
                    ClientPricingMessage: { type: 'string', nullable: true },
                    Metal: {
                        type: 'object',
                        properties: {
                            Weight:  { type: 'number' },
                            Color:   { type: 'string' },
                            Quality: { type: 'string' },
                            Rate:    { type: 'number' },
                        },
                    },
                    Stones: { type: 'array', items: { $ref: '#/components/schemas/PricingStoneInput' } },
                },
            },
            CoralVersion: {
                type: 'object',
                properties: {
                    Version:            { type: 'string', example: 'Version 1' },
                    CoralCode:          { type: 'string' },
                    Cost:               { type: 'number', description: 'Optional fixed cost for this Coral version. Accepted on upload (as form field "cost") and on PUT (as "Cost" in JSON body).' },
                    IsOnlyMetalDesign:  { type: 'boolean', description: 'When true, this design uses metal only (no stones). Affects pricing calculation.' },
                    Images:             { type: 'array', items: { $ref: '#/components/schemas/AssetImage' } },
                    Excel:              { $ref: '#/components/schemas/AssetExcel' },
                    Pricing:            { type: 'array', items: { $ref: '#/components/schemas/PricingSnapshot' } },
                    IsApprovedVersion:  { type: 'boolean' },
                    ReasonForRejection: { type: 'string' },
                    CreatedDate:        { type: 'string', format: 'date-time' },
                },
            },
            CadVersion: {
                type: 'object',
                properties: {
                    Version:            { type: 'string', example: 'Version 1' },
                    CadCode:            { type: 'string' },
                    Cost:               { type: 'number', description: 'Optional fixed cost for this CAD version. Accepted on upload (as form field "cost") and on PUT (as "Cost" in JSON body).' },
                    IsOnlyMetalDesign:  { type: 'boolean', description: 'When true, this design uses metal only (no stones). Affects pricing calculation.' },
                    Images:             { type: 'array', items: { $ref: '#/components/schemas/AssetImage' } },
                    Excel:              { $ref: '#/components/schemas/AssetExcel' },
                    Pricing:            { type: 'array', items: { $ref: '#/components/schemas/PricingSnapshot' } },
                    IsFinalVersion:     { type: 'boolean' },
                    ReasonForRejection: { type: 'string' },
                    CreatedDate:        { type: 'string', format: 'date-time' },
                },
            },
            PricingStoneInput: {
                type: 'object',
                description: 'A stone line from the parsed Excel sheet, with Type set from the enquiry StoneType (Natural / LabGrown / CVDLabGrown).',
                properties: {
                    Type:      { type: 'string' },
                    Color:     { type: 'string' },
                    Shape:     { type: 'string' },
                    MmSize:    { type: 'string' },
                    SieveSize: { type: 'string' },
                    Weight:    { type: 'number' },
                    Pcs:       { type: 'number' },
                    CtWeight:  { type: 'number' },
                    Price:     { type: 'number', description: 'Per-carat price. When clientId is set, this is looked up from Client.Pricing.Diamonds.' },
                    Markup:    { type: 'number' },
                },
            },
            PricingDetails: {
                type: 'object',
                description: 'Pricing input. With a clientId, duty rates and stone prices are sourced from Client.Pricing; without one, all rate/charge fields must be supplied here.',
                properties: {
                    Quantity:            { type: 'number' },
                    TotalPieces:         { type: 'number' },
                    DiamondWeight:       { type: 'number' },
                    Metal: {
                        type: 'object',
                        properties: {
                            Weight:  { type: 'number' },
                            Quality: { type: 'string', description: 'e.g. "14K", "18K", "Silver 925", "Platinum"' },
                            Rate:    { type: 'number', description: 'Optional override; otherwise today\'s market rate is used.' },
                        },
                    },
                    Stones: { type: 'array', items: { $ref: '#/components/schemas/PricingStoneInput' } },
                    Loss:                { type: 'number' },
                    Labour:              { type: 'number' },
                    ExtraCharges: {
                        type: 'object',
                        properties: {
                            Type:  { type: 'string', enum: ['percentage', 'fixed'] },
                            Value: { type: 'number' },
                        },
                    },
                    UndercutPrice:       { type: 'number' },
                    NaturalDuties:       { type: 'number' },
                    LabDuties:           { type: 'number' },
                    GoldDuties:          { type: 'number' },
                    SilverAndLabsDuties: { type: 'number' },
                    LossAndLabourDuties: { type: 'number' },
                },
            },
            PricingResult: {
                type: 'object',
                description: 'Output of calculatePricing. DutiesAmount is the total of all applicable duty buckets; the per-category rates under Client are editable inputs.',
                properties: {
                    MetalPrice:        { type: 'number' },
                    DiamondsPrice:     { type: 'number' },
                    TotalPrice:        { type: 'number' },
                    DutiesAmount:      { type: 'number', description: 'Sum of all duty buckets' },
                    Applicable: {
                        type: 'object',
                        description: 'Flags telling the UI which duty inputs to render for this metal × stone combination.',
                        properties: {
                            NaturalDuties:       { type: 'boolean' },
                            LabDuties:           { type: 'boolean' },
                            GoldDuties:          { type: 'boolean' },
                            SilverAndLabsDuties: { type: 'boolean' },
                            LossAndLabourDuties: { type: 'boolean' },
                        },
                    },
                    Metal: {
                        type: 'object',
                        properties: {
                            Weight:  { type: 'number' },
                            Quality: { type: 'string' },
                            Rate:    { type: 'number' },
                        },
                    },
                    DiamondWeight: { type: 'number' },
                    TotalPieces:   { type: 'number' },
                    Stones: { type: 'array', items: { $ref: '#/components/schemas/PricingStoneInput' } },
                    Client: {
                        type: 'object',
                        description: 'Resolved rates and charges that were applied (echo of policy or per-call inputs).',
                        properties: {
                            Loss:                { type: 'number' },
                            Labour:              { type: 'number' },
                            ExtraCharges: {
                                type: 'object',
                                properties: {
                                    Type:  { type: 'string', enum: ['percentage', 'fixed'] },
                                    Value: { type: 'number' },
                                },
                            },
                            UndercutPrice:       { type: 'number' },
                            NaturalDuties:       { type: 'number' },
                            LabDuties:           { type: 'number' },
                            GoldDuties:          { type: 'number' },
                            SilverAndLabsDuties: { type: 'number' },
                            LossAndLabourDuties: { type: 'number' },
                        },
                    },
                    ClientPricingMessage: { type: 'string', nullable: true, description: 'Present only when the client has a PricingMessageFormat template; LLM-generated.' },
                },
            },
            EnquiryCreateRequest: {
                allOf: [
                    { $ref: '#/components/schemas/EnquiryBase' },
                    {
                        type: 'object',
                        properties: {
                            Status:     { type: 'string' },
                            AssignedTo: { type: 'string' },
                        },
                    },
                ],
            },

            // ── Parse ────────────────────────────────────────────────────────
            ParseRequest: {
                type: 'object',
                required: ['message'],
                properties: {
                    message:   { type: 'string', description: 'Free-text order description from the user' },
                    mediaType: {
                        type: 'string',
                        enum: ['coral', 'cad', 'approved_cad'],
                        description: 'Type of media being requested',
                    },
                },
            },
            MissingField: {
                type: 'object',
                properties: {
                    field:   { type: 'string', example: 'Metal.Color' },
                    label:   { type: 'string', example: 'Metal Colour' },
                    options: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string' },
                                value: { type: 'string' },
                            },
                        },
                    },
                },
            },
            ParseResponse: {
                type: 'object',
                properties: {
                    parsed: { $ref: '#/components/schemas/EnquiryBase' },
                    missingFields: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/MissingField' },
                    },
                },
            },

            // ── Chat & Message ───────────────────────────────────────────────
            Chat: {
                type: 'object',
                properties: {
                    _id:         { type: 'string' },
                    EnquiryId:   { type: 'string' },
                    Name:        { type: 'string' },
                    Type:        { type: 'string', enum: ['admin-client', 'admin-designer'] },
                    Participants: { type: 'array', items: { type: 'string' } },
                    LastMessage: { type: 'string' },
                    UpdatedAt:   { type: 'string', format: 'date-time' },
                },
            },
            Message: {
                type: 'object',
                properties: {
                    _id:       { type: 'string' },
                    ChatId:    { type: 'string' },
                    SenderId:  { type: 'string' },
                    Content:   { type: 'string' },
                    MediaUrl:  { type: 'string' },
                    IsDeleted: { type: 'boolean' },
                    CreatedAt: { type: 'string', format: 'date-time' },
                },
            },

            // ── Notifications ────────────────────────────────────────────────
            Notification: {
                type: 'object',
                properties: {
                    _id:     { type: 'string' },
                    UserId:  { type: 'string' },
                    Title:   { type: 'string' },
                    Body:    { type: 'string' },
                    Type:    { type: 'string' },
                    Link:    { type: 'string' },
                    IsRead:  { type: 'boolean' },
                    CreatedAt: { type: 'string', format: 'date-time' },
                },
            },

            // ── Codelists ────────────────────────────────────────────────────
            CodeValue: {
                type: 'object',
                properties: {
                    Id:   { },
                    Code: { type: 'string' },
                    Name: { type: 'string' },
                },
            },

            // ── Image Validation ─────────────────────────────────────────────
            ImageValidationResult: {
                type: 'object',
                description: 'LLM-generated comparison of a jewelry image against the enquiry description AND the enquiry Checklist.',
                properties: {
                    summary:    { type: 'string', description: 'Short paragraph summarising the overall result' },
                    issues: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Combined list of observations. Each entry is a plain string prefixed with one of two headers followed by " - ":\n• "Checklist Verification - <field> \'<customer value>\': <observation>" — one entry per non-NA checklist item (items that cannot be visually verified, like ring size or delivery date, are explicitly called out).\n• "Design Consistency - <observation>" — general design/metal/stone mismatches. Contains "Design Consistency - No issues found" when there are no design issues.',
                    },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'LLM confidence in the comparison' },
                },
                required: ['summary', 'issues', 'confidence'],
            },

            // ── Errors ───────────────────────────────────────────────────────
            Error: {
                type: 'object',
                properties: {
                    message: { type: 'string' },
                },
            },
        },
    },

    // ── Security default (override per-route where needed) ─────────────────────
    security: [{ bearerAuth: [] }],

    paths: {
        // ════════════════════════════════════════════════════════════════════
        // Health
        // ════════════════════════════════════════════════════════════════════
        '/health': {
            get: {
                tags: ['System'],
                summary: 'Health check',
                security: [],
                responses: {
                    200: {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        db:     { type: 'number', example: 1 },
                                        uptime: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                    503: { description: 'Server degraded (DB disconnected)' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Auth
        // ════════════════════════════════════════════════════════════════════
        '/api/login': {
            post: {
                tags: ['Auth'],
                summary: 'Login and receive a JWT',
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
                    },
                },
                responses: {
                    200: {
                        description: 'JWT token',
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } },
                        },
                    },
                    400: { description: 'Invalid credentials' },
                    500: { description: 'Server error' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Clients
        // ════════════════════════════════════════════════════════════════════
        '/api/clients': {
            get: {
                tags: ['Clients'],
                summary: 'Get all clients',
                responses: {
                    200: {
                        description: 'List of clients',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Client' } },
                            },
                        },
                    },
                },
            },
            post: {
                tags: ['Clients'],
                summary: 'Create a new client',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/Client' } },
                    },
                },
                responses: {
                    201: { description: 'Client created' },
                    500: { description: 'Server error' },
                },
            },
        },
        '/api/clients/{id}': {
            get: {
                tags: ['Clients'],
                summary: 'Get client by ID',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                responses: {
                    200: {
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/Client' } },
                        },
                    },
                    404: { description: 'Not found' },
                },
            },
            put: {
                tags: ['Clients'],
                summary: 'Update client by ID',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/Client' } },
                    },
                },
                responses: {
                    200: { description: 'Updated client' },
                    404: { description: 'Not found' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Users
        // ════════════════════════════════════════════════════════════════════
        '/api/users': {
            get: {
                tags: ['Users'],
                summary: 'Get all users',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' } },
                            },
                        },
                    },
                },
            },
            post: {
                tags: ['Users'],
                summary: 'Create a new user',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'email', 'role', 'password'],
                                properties: {
                                    name:     { type: 'string' },
                                    email:    { type: 'string', format: 'email' },
                                    phone:    { type: 'string' },
                                    role:     { type: 'number' },
                                    password: { type: 'string' },
                                    clientId: { type: 'string' },
                                    skills:   { type: 'string' },
                                    group:    { type: 'string', enum: ['Bridal', 'Hip-hop', 'Cuban'] },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: { description: 'Created user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
                    400: { description: 'Missing required fields' },
                    409: { description: 'Email or phone already in use' },
                },
            },
        },
        '/api/users/{id}': {
            get: {
                tags: ['Users'],
                summary: 'Get user by ID',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                responses: {
                    200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
                    404: { description: 'Not found' },
                },
            },
            put: {
                tags: ['Users'],
                summary: 'Update a user (password cannot be changed here)',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name:     { type: 'string' },
                                    email:    { type: 'string', format: 'email' },
                                    phone:    { type: 'string' },
                                    role:     { type: 'number' },
                                    clientId: { type: 'string' },
                                    skills:   { type: 'string' },
                                    group:    { type: 'string', enum: ['Bridal', 'Hip-hop', 'Cuban'] },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
                    404: { description: 'User not found' },
                    409: { description: 'Email or phone already in use' },
                },
            },
        },
        '/api/users/registerPushToken': {
            post: {
                tags: ['Users'],
                summary: 'Register an FCM push token for the authenticated user',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['token'],
                                properties: { token: { type: 'string' } },
                            },
                        },
                    },
                },
                responses: {
                    200: { description: 'Push token saved' },
                    400: { description: 'Token required' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Metal Prices
        // ════════════════════════════════════════════════════════════════════
        '/api/metal-prices': {
            get: {
                tags: ['Metal Prices'],
                summary: 'Get all metal price entries',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/MetalPrice' } },
                            },
                        },
                    },
                },
            },
            post: {
                tags: ['Metal Prices'],
                summary: 'Add a new metal price entry',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/MetalPrice' } },
                    },
                },
                responses: { 201: { description: 'Created' } },
            },
        },
        '/api/metal-prices/latest': {
            get: {
                tags: ['Metal Prices'],
                summary: 'Get the latest price for each metal',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/MetalPrice' } },
                            },
                        },
                    },
                },
            },
        },
        '/api/metal-prices/{metal}': {
            put: {
                tags: ['Metal Prices'],
                summary: 'Update price for a specific metal',
                parameters: [{ in: 'path', name: 'metal', required: true, schema: { type: 'string' }, example: 'gold' }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/MetalPrice' } },
                    },
                },
                responses: { 200: { description: 'Updated' } },
            },
            delete: {
                tags: ['Metal Prices'],
                summary: 'Delete a metal price entry',
                parameters: [{ in: 'path', name: 'metal', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Deleted' } },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Enquiries
        // ════════════════════════════════════════════════════════════════════
        '/api/enquiries/parse': {
            post: {
                tags: ['Enquiries'],
                summary: 'Parse a free-text message into a structured enquiry draft',
                description: 'Calls OpenAI to extract enquiry fields. Returns `parsed` (filled fields) and `missingFields` (fields the LLM could not determine, with options for the frontend to resolve).',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/ParseRequest' } },
                    },
                },
                responses: {
                    200: {
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/ParseResponse' } },
                        },
                    },
                    400: { description: '`message` field is required' },
                    500: { description: 'LLM or server error' },
                },
            },
        },
        '/api/enquiries/export-pdf': {
            get: {
                tags: ['Enquiries'],
                summary: 'Export enquiries as PDF',
                description: 'Generates a PDF report. The reportType param selects the format — each format has its own column layout and may apply its own base filters on top of the query filters (e.g. coral-pending forces status=Coral). design-approval-pending uses a section-per-client grouped layout.',
                parameters: [
                    { in: 'query', name: 'reportType',
                      schema: { type: 'string',
                                enum: ['enquiries-list', 'coral-pending', 'cad-pending', 'design-approval-pending'],
                                default: 'enquiries-list' },
                      description: 'Which report format to generate' },
                    { in: 'query', name: 'search',   schema: { type: 'string' } },
                    { in: 'query', name: 'status',   schema: { type: 'string' }, description: 'Ignored when the report has its own base status filter' },
                    { in: 'query', name: 'clientId', schema: { type: 'string' } },
                    { in: 'query', name: 'priority', schema: { type: 'string' } },
                    { in: 'query', name: 'sortBy',   schema: { type: 'string' }, description: 'Overrides the format default sort' },
                    { in: 'query', name: 'sortOrder', schema: { type: 'string', enum: ['asc', 'desc'] } },
                ],
                responses: {
                    200: { description: 'PDF file', content: { 'application/pdf': {} } },
                },
            },
        },
        '/api/enquiries/search': {
            get: {
                tags: ['Enquiries'],
                summary: 'Search and filter enquiries',
                parameters: [
                    { in: 'query', name: 'search',            schema: { type: 'string' }, description: 'Full-text search across Name, StyleNumber, CoralCode, CadCode, GatiOrderNumber, Stamping, Remarks, SpecialRemarks' },
                    { in: 'query', name: 'id',                schema: { type: 'string' }, description: 'Comma-separated list of enquiry ObjectIds' },
                    { in: 'query', name: 'status',            schema: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, description: 'Single status or array of statuses (computed from last StatusHistory entry)' },
                    { in: 'query', name: 'subStatus',         schema: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, description: 'Single sub-status or array (computed from last StatusHistory entry). E.g. Assign Pending, Assigned, Rejected - Redo, Cost Missing, Quotation Review, Final Cad Upload' },
                    { in: 'query', name: 'clientId',          schema: { type: 'string' } },
                    { in: 'query', name: 'category',          schema: { type: 'string' } },
                    { in: 'query', name: 'priority',          schema: { type: 'string', enum: ['Normal', 'High', 'Super High'] } },
                    { in: 'query', name: 'metalColor',        schema: { type: 'string' } },
                    { in: 'query', name: 'metalQuality',      schema: { type: 'string' } },
                    { in: 'query', name: 'stoneType',         schema: { type: 'string' } },
                    { in: 'query', name: 'assignedTo',        schema: { type: 'string' }, description: 'User ID currently assigned (last StatusHistory entry)' },
                    { in: 'query', name: 'unassigned',        schema: { type: 'boolean' }, description: 'When true, returns only enquiries whose last StatusHistory entry has no AssignedTo (null / missing / empty). Overridden if assignedTo is also passed.' },
                    { in: 'query', name: 'allClients',        schema: { type: 'boolean' }, description: 'Client Handlers only — when true, bypasses client-scoping and returns data across all clients (used when covering for an absent colleague). No effect for other roles.' },
                    { in: 'query', name: 'shippingDateFrom',  schema: { type: 'string', format: 'date-time' } },
                    { in: 'query', name: 'shippingDateTo',    schema: { type: 'string', format: 'date-time' } },
                    { in: 'query', name: 'assignedDateFrom',  schema: { type: 'string', format: 'date-time' } },
                    { in: 'query', name: 'assignedDateTo',    schema: { type: 'string', format: 'date-time' } },
                    { in: 'query', name: 'createdDateFrom',   schema: { type: 'string', format: 'date-time' } },
                    { in: 'query', name: 'createdDateTo',     schema: { type: 'string', format: 'date-time' } },
                    { in: 'query', name: 'page',              schema: { type: 'integer', default: 1 } },
                    { in: 'query', name: 'limit',             schema: { type: 'integer', default: 25 } },
                    { in: 'query', name: 'sortBy',            schema: { type: 'string', default: 'AssignedDate' } },
                    { in: 'query', name: 'sortOrder',         schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
                ],
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        data:  { type: 'array', items: { $ref: '#/components/schemas/EnquirySearchItem' } },
                                        total: { type: 'number' },
                                        page:  { type: 'number' },
                                        limit: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/enquiries/aggregate': {
            get: {
                tags: ['Enquiries'],
                summary: 'Get aggregated enquiry counts',
                description: 'Returns counts grouped by the chosen dimension.\n\n- `groupBy=status` → `[{ name, count }]` per current status.\n- `groupBy=client` → `[{ name, count }]` per ClientId (restricted to Enquiry Created, Coral, CAD).\n- `groupBy=buckets` → dashboard counts in a single object: `{ unassigned, wip, approvalPending }`. WIP = Coral / Cad; Unassigned = latest status has no AssignedTo; Approval Pending = status "Design Approval Pending".',
                parameters: [
                    { in: 'query', name: 'groupBy', required: true, schema: { type: 'string', enum: ['status', 'client', 'buckets'] }, example: 'buckets' },
                    { in: 'query', name: 'clientId', schema: { type: 'string' }, description: 'Optional — scopes all counts to a single client' },
                    { in: 'query', name: 'assignedTo', schema: { type: 'string' }, description: 'Optional — scopes counts to a single assignee (status/client modes)' },
                    { in: 'query', name: 'allClients', schema: { type: 'boolean' }, description: 'Client Handlers only — when true, bypasses client-scoping and counts across all clients. No effect for other roles.' },
                ],
                responses: {
                    200: {
                        description: 'Aggregated counts',
                        content: {
                            'application/json': {
                                schema: {
                                    oneOf: [
                                        {
                                            type: 'array',
                                            description: 'Returned for groupBy=status or groupBy=client',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    name:  { type: 'string' },
                                                    count: { type: 'number' },
                                                },
                                            },
                                        },
                                        {
                                            type: 'object',
                                            description: 'Returned for groupBy=buckets',
                                            properties: {
                                                unassigned:      { type: 'number' },
                                                wip:             { type: 'number' },
                                                approvalPending: { type: 'number' },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    400: { description: 'Missing or invalid groupBy parameter' },
                },
            },
        },
        '/api/enquiries/pricingCalculate': {
            post: {
                tags: ['Enquiries'],
                summary: 'Calculate pricing for an enquiry',
                description: 'On initial calculation (isRecalculate: false), duty rates and stone prices are resolved from Client.Pricing. On recalculation (isRecalculate: true, used after the user edits duty rates on the frontend), the caller\'s details values are used verbatim and only PricingMessageFormat is read from the client. clientId is always required.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['details', 'clientId'],
                                properties: {
                                    details:       { $ref: '#/components/schemas/PricingDetails' },
                                    clientId:      { type: 'string' },
                                    isRecalculate: { type: 'boolean', default: false },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Pricing result',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/PricingResult' },
                            },
                        },
                    },
                },
            },
        },
        '/api/enquiries/mass-action': {
            post: {
                tags: ['Enquiries'],
                summary: 'Apply a bulk action to multiple enquiries',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['enquiryIds', 'updateType'],
                                properties: {
                                    enquiryIds:  { type: 'array', items: { type: 'string' } },
                                    updateType:  { type: 'string' },
                                    newStatus:   { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: { 200: { description: 'Mass action result' } },
            },
        },
        '/api/enquiries/files/{key}': {
            get: {
                tags: ['Enquiries'],
                summary: 'Get a presigned S3 URL for a file',
                parameters: [
                    { in: 'path',  name: 'key',      required: true, schema: { type: 'string' } },
                    { in: 'query', name: 'download',  schema: { type: 'boolean' }, description: 'Set true to force download' },
                ],
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { url: { type: 'string' } } },
                            },
                        },
                    },
                    400: { description: 'Invalid S3 key' },
                },
            },
        },
        '/api/enquiries': {
            post: {
                tags: ['Enquiries'],
                summary: 'Create a new enquiry (multipart, with reference images)',
                description: 'Send the enquiry payload as a stringified JSON in the `data` field. Attach up to 10 reference files (images, videos, PDFs — anything) under the `referenceImages` field, each up to 50 MB.\n\nAfter creation, an async hook describes/embeds the reference images, auto-assigns a Coral or Cad designer based on user skills, and populates `SimilarDesigns` on the enquiry. Two independent async Gemini hooks also run: one extracts the 9-field jewelry manufacturing `Checklist` from `Remarks` / `SpecialRemarks`, the other generates a designer-facing Markdown `Summary` from the full enquiry. Fetch the enquiry a few seconds later to see both populated.',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                required: ['data'],
                                properties: {
                                    data: {
                                        type: 'string',
                                        description: 'Stringified JSON of EnquiryCreateRequest',
                                        example: '{"Name":"Diamond ring","Status":"Coral","ClientId":"66a..."}',
                                    },
                                    referenceImages: {
                                        type: 'array',
                                        items: { type: 'string', format: 'binary' },
                                        description: 'Reference files (images, videos, etc.) up to 10 files, max 50 MB each',
                                    },
                                },
                            },
                        },
                        'application/json': { schema: { $ref: '#/components/schemas/EnquiryCreateRequest' } },
                    },
                },
                responses: {
                    201: { description: 'Enquiry ID of the created enquiry' },
                    400: { description: "Invalid JSON in 'data' field" },
                    500: { description: 'Server error' },
                },
            },
        },
        '/api/enquiries/{id}': {
            get: {
                tags: ['Enquiries'],
                summary: 'Get enquiry by ID',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                responses: {
                    200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Enquiry' } } } },
                    404: { description: 'Not found' },
                },
            },
            put: {
                tags: ['Enquiries'],
                summary: 'Update enquiry by ID',
                description: 'Updates the enquiry. STATUS/SUB-STATUS RULES: the current state is the last StatusHistory entry; the backend owns sub-status logic. Normal edits should send only changed data fields + `AssignedTo` — never `SubStatus`. On reassignment the backend derives `Assigned`/`Assign Pending`. Sending a `Status` different from the current one is treated as an ADMIN OVERRIDE: if `SubStatus` is provided it must be a valid pair for that Status (else 400); if omitted, the backend derives the assignment-based sub-status from the effective assignee (carried forward when `AssignedTo` isn\'t sent). Allowed pairs — Coral/Cad: Assign Pending, Assigned, Rejected - Redo, Cost Missing, Quotation Review (+ Final Cad Upload for Cad); Enquiry Created / Design Approval Pending / Order Placement: none. Everyday workflow transitions should flow through the asset-upload/approve actions, not this endpoint. Also fires two async Gemini hooks (Checklist + Summary regeneration); the response returns immediately.',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/EnquiryBase' } },
                    },
                },
                responses: { 200: { description: 'Updated enquiry' } },
            },
            delete: {
                tags: ['Enquiries'],
                summary: 'Delete enquiry by ID',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                responses: {
                    200: { description: 'Deleted' },
                    404: { description: 'Not found' },
                },
            },
        },
        '/api/enquiries/{id}/upload/{type}': {
            post: {
                tags: ['Enquiries'],
                summary: 'Upload assets (coral / cad / reference) for an enquiry',
                parameters: [
                    { in: 'path', name: 'id',   required: true, schema: { type: 'string' } },
                    { in: 'path', name: 'type',  required: true, schema: { type: 'string', enum: ['coral', 'cad', 'reference'] } },
                    { in: 'query', name: 'version', schema: { type: 'string' } },
                ],
                requestBody: {
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    images:  { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Image files for the version' },
                                    excel:   { type: 'string', format: 'binary', description: 'Optional pricing excel sheet (coral / cad only)' },
                                    version: { type: 'string', description: 'Version label, e.g. "Version 1"' },
                                    code:    { type: 'string', description: 'CoralCode or CadCode for the version' },
                                    cost:    { type: 'number', description: 'Optional fixed cost for this version (coral / cad only). Stored as Number on the Coral/Cad subdocument.' },
                                },
                            },
                        },
                    },
                },
                responses: { 200: { description: 'Upload result' } },
            },
            put: {
                tags: ['Enquiries'],
                summary: 'Update asset metadata (approve, reject, cost, etc.)',
                parameters: [
                    { in: 'path', name: 'id',   required: true, schema: { type: 'string' } },
                    { in: 'path', name: 'type',  required: true, schema: { type: 'string', enum: ['coral', 'cad', 'reference'] } },
                    { in: 'query', name: 'version', schema: { type: 'string' } },
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                description: 'Partial update of a Coral / CAD version. Only the keys you send are applied.',
                                properties: {
                                    IsApprovedVersion:  { type: 'boolean', description: 'Coral only — true to approve (moves to Cad), false (with ReasonForRejection) to reject (SubStatus → Rejected - Redo)' },
                                    IsFinalVersion:     { type: 'boolean', description: 'CAD only — true to mark as final (moves to Order Placement), false (with ReasonForRejection) to reject (SubStatus → Rejected - Redo)' },
                                    ReasonForRejection: { type: 'string' },
                                    SendForApproval:    { type: 'boolean', description: 'Set true (after the quotation is reviewed) to move the enquiry to "Design Approval Pending". Replaces the retired ShowToClient flag.' },
                                    CoralCode:          { type: 'string' },
                                    CadCode:            { type: 'string' },
                                    Cost:               { type: 'number', description: 'Update the fixed cost for this Coral / CAD version' },
                                    Pricing:            { type: 'array', items: { $ref: '#/components/schemas/PricingSnapshot' } },
                                    Id:                 { type: 'string', description: 'Image Id when updating or deleting a single image within the version' },
                                    Description:        { type: 'string', description: 'New description for the image identified by Id' },
                                    Delete:             { type: 'boolean', description: 'When true with Id, deletes a single image; when true without Id, deletes the entire version' },
                                },
                            },
                        },
                    },
                },
                responses: { 200: { description: 'Update result' } },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Chats
        // ════════════════════════════════════════════════════════════════════
        '/api/chats': {
            get: {
                tags: ['Chats'],
                summary: 'Get all chats for the authenticated user',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Chat' } },
                            },
                        },
                    },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Messages
        // ════════════════════════════════════════════════════════════════════
        '/api/message/{chatId}/messages': {
            get: {
                tags: ['Messages'],
                summary: 'Get all messages in a chat',
                parameters: [{ in: 'path', name: 'chatId', required: true, schema: { type: 'string' } }],
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
                            },
                        },
                    },
                },
            },
        },
        '/api/message/upload': {
            post: {
                tags: ['Messages'],
                summary: 'Upload a media file within a chat',
                requestBody: {
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    file:   { type: 'string', format: 'binary' },
                                    chatId: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: { 200: { description: 'Uploaded file URL' } },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Codelists
        // ════════════════════════════════════════════════════════════════════
        '/api/codelists/{name}': {
            get: {
                tags: ['Codelists'],
                summary: 'Get a codelist by type name',
                security: [],
                parameters: [
                    {
                        in: 'path', name: 'name', required: true,
                        schema: { type: 'string' },
                        description: 'Codelist type, e.g. Roles, Status, StoneTypes, StoneShapes',
                    },
                ],
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/CodeValue' } },
                            },
                        },
                    },
                    404: { description: 'Codelist not found' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Notifications
        // ════════════════════════════════════════════════════════════════════
        '/api/notifications': {
            get: {
                tags: ['Notifications'],
                summary: 'Get all notifications for the authenticated user',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
                            },
                        },
                    },
                },
            },
        },
        '/api/notifications/unread-count': {
            get: {
                tags: ['Notifications'],
                summary: 'Get the unread notification count',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { count: { type: 'number' } } },
                            },
                        },
                    },
                },
            },
        },
        '/api/notifications/escalations': {
            get: {
                tags: ['Notifications'],
                summary: 'Get the authenticated user\'s escalation alerts (escalation dashboard)',
                description: 'Returns the current user\'s notifications of Type "escalation" (newest first) — the SLA-delay alerts raised by the daily escalation job for stuck Coral/Cad enquiries. Same rows also appear in GET /api/notifications.',
                parameters: [{ in: 'query', name: 'limit', schema: { type: 'integer', default: 50, maximum: 100 } }],
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
                            },
                        },
                    },
                },
            },
        },
        '/api/notifications/escalations/unread-count': {
            get: {
                tags: ['Notifications'],
                summary: 'Get the unread escalation-alert count (badge)',
                responses: {
                    200: {
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { count: { type: 'number' } } },
                            },
                        },
                    },
                },
            },
        },
        '/api/notifications/mark-all-read': {
            post: {
                tags: ['Notifications'],
                summary: 'Mark all notifications as read',
                responses: { 200: { description: 'All marked read' } },
            },
        },
        '/api/notifications/{id}/read': {
            patch: {
                tags: ['Notifications'],
                summary: 'Mark a single notification as read',
                parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
                responses: {
                    200: { description: 'Marked read' },
                    404: { description: 'Not found' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Image Pricing
        // ════════════════════════════════════════════════════════════════════
        '/api/image-pricing': {
            post: {
                tags: ['Image Pricing'],
                summary: 'Extract stone/metal data from an image and return pricing',
                description: 'Uploads a jewelry data-table image to GPT-4o Vision, which extracts the stones table (color, shape, mm size, sieve size, average weight, pcs, ct weight), metal weight, and metal quality. The extracted data is then passed to the pricing engine along with the client ID to produce a full pricing breakdown. Returns both the raw extracted data and the calculated pricing.',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                required: ['image', 'clientId', 'stoneType'],
                                properties: {
                                    image: { type: 'string', format: 'binary', description: 'Image of the jewelry data table (max 20 MB)' },
                                    clientId: { type: 'string', description: 'MongoDB ObjectId of the client (used to apply client-specific pricing policy)' },
                                    stoneType: { type: 'string', description: 'Stone type to apply to all stones (e.g. LabGrown, CVDLabGrown). Defaults to empty if omitted.' },
                                    quantity: { type: 'integer', description: 'Number of pieces to price. Defaults to 1.' },
                                    metalQuality: { type: 'string', description: 'Override metal quality (e.g. 18K, 14K, Silver 925, Platinum). If omitted, extracted from image.' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Extracted data and calculated pricing',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        extractedData: {
                                            type: 'object',
                                            description: 'Raw data extracted by the LLM from the image',
                                            properties: {
                                                Stones: {
                                                    type: 'array',
                                                    items: { $ref: '#/components/schemas/StoneInput' },
                                                },
                                                Metal: {
                                                    type: 'object',
                                                    properties: {
                                                        Weight: { type: 'string' },
                                                        Quality: { type: 'string' },
                                                    },
                                                },
                                                TotalPieces: { type: 'integer' },
                                            },
                                        },
                                        pricing: { $ref: '#/components/schemas/PricingResult' },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: 'Missing image or clientId, or LLM extraction failed' },
                    500: { description: 'LLM call failed or pricing engine error' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Jewelry Estimator
        // ════════════════════════════════════════════════════════════════════
        '/api/jewelry-estimate': {
            post: {
                tags: ['Jewelry Estimator'],
                summary: 'Estimate a ring BOM from images and return a price matrix',
                description: 'Uploads ring images (top view required; side, 45-degree, and up to 5 additional optional) plus an optional description and ring size to a Vision LLM (Gemini 2.5 Pro), which estimates the bill of materials: stone shapes, carat weights, mm sizes, counts, and a single 10K-gold weight — estimation only (it never decides Natural vs Lab, quality, color, purity, price, or labour). The estimated BOM is then priced deterministically by the existing pricing engine against the given client\'s rate card, across a metal × stone-type matrix. Non-10K metal weights are derived from the 10K estimate by density ratio. Stateless — no image is stored. One LLM call (retried once on malformed output); no per-cell pricing-message LLM calls.',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                required: ['topView', 'clientId'],
                                properties: {
                                    topView:       { type: 'string', format: 'binary', description: 'Top view of the ring (required, max 10 MB)' },
                                    sideView:      { type: 'string', format: 'binary', description: 'Side view (optional)' },
                                    fortyFiveView: { type: 'string', format: 'binary', description: '45-degree view (optional)' },
                                    additional:    { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Up to 5 additional images (optional)' },
                                    clientId:      { type: 'string', description: 'MongoDB ObjectId of the client whose rate card prices the matrix' },
                                    description:   { type: 'string', description: 'Optional free-text description sent to the LLM. If a ring size is mentioned here it is used; otherwise size 7 is assumed.' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'AI estimate plus a metal × stone-type price matrix',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        estimate: {
                                            type: 'object',
                                            description: 'Raw AI estimate (estimation only)',
                                            properties: {
                                                stones: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            shape:       { type: 'string', nullable: true },
                                                            weightCarat: { type: 'number', nullable: true },
                                                            sizeMM:      { type: 'number', nullable: true },
                                                            count:       { type: 'integer' },
                                                            confidence:  { type: 'number' },
                                                        },
                                                    },
                                                },
                                                estimated10KWeightGrams: { type: 'number' },
                                                confidence:              { type: 'number' },
                                            },
                                        },
                                        matrix: {
                                            type: 'array',
                                            description: 'One cell per metal × stone-type combination',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    metalQuality:     { type: 'string', example: '14K' },
                                                    stoneType:        { type: 'string', example: 'NaturalRegular' },
                                                    metalWeightGrams: { type: 'number', description: '10K weight converted to this metal by density ratio' },
                                                    pricing:          { $ref: '#/components/schemas/PricingResult' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    400: { description: 'Missing topView or clientId, or an image exceeds the inline limit' },
                    500: { description: 'LLM call failed / returned invalid output, or pricing engine error' },
                },
            },
        },

        // ════════════════════════════════════════════════════════════════════
        // Image Validation
        // ════════════════════════════════════════════════════════════════════
        '/api/validate-image': {
            post: {
                tags: ['Image Validation'],
                summary: 'Validate a jewelry image against an enquiry description',
                description: 'Fetches the enquiry from the database (source of truth), builds a description from its fields (Category, Metal, StoneType, Remarks, SpecialRemarks) AND every non-NA item from the enquiry `Checklist`, then calls **Google Gemini 2.5 Flash** to compare the uploaded image against that description PLUS up to 5 of the enquiry\'s reference attachments (images and/or short videos pulled inline from S3) as visual ground truth. The model verifies each checklist item explicitly against the image (or marks it as not visually verifiable) and adds general design-consistency observations on top, cross-referenced with the customer\'s original attachments. Non-image / non-video reference files (PDFs) and any single attachment over ~20 MB are skipped; the count is mentioned in the prompt so the model knows. Returns a flat `issues` array of `Header - point` strings and a confidence level. Stateless — no image is stored.',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                required: ['image', 'enquiryId'],
                                properties: {
                                    image:     { type: 'string', format: 'binary', description: 'Jewelry image (any common image format, max 10 MB)' },
                                    enquiryId: { type: 'string', description: 'MongoDB ObjectId of the enquiry to validate against' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Validation result',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ImageValidationResult' },
                            },
                        },
                    },
                    400: { description: 'Missing image or enquiryId, or enquiry has no usable description' },
                    404: { description: 'Enquiry not found' },
                    500: { description: 'LLM call failed or returned an invalid response' },
                },
            },
        },
    },
};

module.exports = swaggerSpec;
