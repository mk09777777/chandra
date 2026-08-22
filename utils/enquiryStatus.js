// Single source of truth for enquiry Status / SubStatus rules.
// An enquiry has no top-level Status/SubStatus — current state is the last StatusHistory entry.

const STATUSES = {
    ENQUIRY_CREATED: 'Enquiry Created',
    CORAL: 'Coral',
    CAD: 'Cad',
    DESIGN_APPROVAL_PENDING: 'Design Approval Pending',
    ORDER_PLACEMENT: 'Order Placement',
};

const SUBSTATUSES = {
    ASSIGN_PENDING: 'Assign Pending',
    ASSIGNED: 'Assigned',
    REJECTED_REDO: 'Rejected - Redo',
    COST_MISSING: 'Cost Missing',
    QUOTATION_REVIEW: 'Quotation Review',
    FINAL_CAD_UPLOAD: 'Final Cad Upload',
};

// Allowed sub-statuses per status (null = no sub-status). Used to validate the admin override.
const ALLOWED_SUBSTATUS_BY_STATUS = {
    'Enquiry Created': [null],
    'Coral': ['Assign Pending', 'Assigned', 'Rejected - Redo', 'Cost Missing', 'Quotation Review'],
    'Cad': ['Assign Pending', 'Assigned', 'Rejected - Redo', 'Cost Missing', 'Quotation Review', 'Final Cad Upload'],
    'Design Approval Pending': [null],
    'Order Placement': [null],
};

// Default sub-status when a status change carries no explicit one (assignment, massAction, override w/o subStatus).
function deriveSubStatus(targetStatus, { assignedTo } = {}) {
    if (targetStatus === 'Coral' || targetStatus === 'Cad') {
        return (assignedTo && String(assignedTo).trim()) ? 'Assigned' : 'Assign Pending';
    }
    return null;
}

function isValidPair(status, subStatus) {
    const allowed = ALLOWED_SUBSTATUS_BY_STATUS[status];
    return allowed ? allowed.includes(subStatus ?? null) : true; // unknown status → don't block
}

// The ONE place a StatusHistory entry is appended. Carries AssignedTo forward from the last entry when omitted.
function appendStatusEntry(enquiry, { status, subStatus = null, assignedTo, addedBy, details }) {
    const last = enquiry.StatusHistory?.at(-1);
    enquiry.StatusHistory.push({
        Status: status,
        SubStatus: subStatus,
        AssignedTo: assignedTo !== undefined ? assignedTo : (last?.AssignedTo ?? null),
        AddedBy: addedBy || 'System',
        Timestamp: new Date(),
        Details: details || '',
    });
}

module.exports = { STATUSES, SUBSTATUSES, ALLOWED_SUBSTATUS_BY_STATUS, deriveSubStatus, isValidPair, appendStatusEntry };
