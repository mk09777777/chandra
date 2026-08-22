const repo = require('../repositories/enquiry.repo');
const userService = require('./user.service');
const codelistsService = require('./codelists.service');
const notificationService = require('./notifications.service');

// --- Business rules (hardcoded) -------------------------------------------------
const HANDLER_DAYS = 1;                                  // handler escalation, all priorities
const ADMIN_DAYS = { 'Super High': 1, 'High': 2, 'Normal': 3 }; // admin escalation per priority
const BUMP_INTERVAL_DAYS = 2;                            // +1 priority level per this many days stuck
const PRIORITY_ORDER = ['Normal', 'High', 'Super High'];
const DESIGN_STATUSES = ['Coral', 'Cad'];

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC) for per-day dedup
const priorityLevel = (p) => { const i = PRIORITY_ORDER.indexOf(p); return i < 0 ? 0 : i; };
const adminThreshold = (p) => ADMIN_DAYS[p] ?? ADMIN_DAYS['Normal'];

async function resolveAdminIds() {
    const roles = await codelistsService.getCodelistByName('Roles');
    const adminRoleId = roles?.find(r => r.Code === 'AD')?.Id;
    if (adminRoleId == null) return [];
    return userService.getUsersByRole(adminRoleId);
}

async function notify(userIds, enquiry, daysInStatus, priority) {
    if (!userIds || userIds.length === 0) return;
    const title = '⏰ Enquiry delayed';
    const body = `"${enquiry.Name || 'Enquiry'}" has been in ${enquiry.CurrentStatus} for ${daysInStatus} day(s) (priority ${priority}). Needs attention.`;
    try {
        await notificationService.createAlertsForUsers(userIds, title, body, 'escalation', `enquiries/${enquiry._id}`);
    } catch (err) {
        // DB rows are saved before push inside createAlertsForUsers; a push failure must not abort the run.
        console.error(`[escalation] notify failed for enquiry ${enquiry._id}:`, err.message);
    }
}

// Daily SLA pass: escalate stuck Coral/Cad enquiries and auto-bump their priority.
async function runEscalations() {
    const now = Date.now();
    const cutoff = new Date(now - HANDLER_DAYS * 86400000);
    const stuck = await repo.findStuckInDesignStatuses(cutoff);
    if (!stuck.length) {
        console.log('[escalation] no stuck enquiries');
        return { processed: 0, total: 0 };
    }

    const adminIds = await resolveAdminIds();
    const handlerCache = new Map();
    const getHandlers = async (clientId) => {
        const key = String(clientId || '');
        if (!handlerCache.has(key)) {
            handlerCache.set(key, await userService.getClientHandlersForClient(clientId).catch(() => []));
        }
        return handlerCache.get(key);
    };

    const today = dayKey(now);
    let processed = 0;

    for (const e of stuck) {
        try {
            const statusAtMs = new Date(e.StatusAt).getTime();
            const daysInStatus = Math.floor((now - statusAtMs) / 86400000);
            const anchorIso = new Date(e.StatusAt).toISOString();

            // Reset bookkeeping when the status window changed since we last looked.
            let esc = e.Escalation;
            if (!esc || !esc.StatusAnchor || new Date(esc.StatusAnchor).toISOString() !== anchorIso) {
                esc = { StatusAnchor: new Date(e.StatusAt), Bumps: 0, LastHandlerAlertOn: null, LastAdminAlertOn: null };
            } else {
                esc = {
                    StatusAnchor: new Date(esc.StatusAnchor),
                    Bumps: esc.Bumps || 0,
                    LastHandlerAlertOn: esc.LastHandlerAlertOn || null,
                    LastAdminAlertOn: esc.LastAdminAlertOn || null,
                };
            }

            // Auto-bump priority progressively, capped at Super High. Only ever raises.
            let priority = PRIORITY_ORDER[priorityLevel(e.Priority)]; // normalize unknown → Normal
            const targetBumps = Math.floor(daysInStatus / BUMP_INTERVAL_DAYS);
            let bumped = false;
            while (esc.Bumps < targetBumps && priorityLevel(priority) < PRIORITY_ORDER.length - 1) {
                priority = PRIORITY_ORDER[priorityLevel(priority) + 1];
                esc.Bumps += 1;
                bumped = true;
            }
            if (bumped) await repo.updatePriority(e._id, priority);

            // Handler escalation (>= 1 day, every priority), repeats daily.
            if (daysInStatus >= HANDLER_DAYS && esc.LastHandlerAlertOn !== today) {
                await notify(await getHandlers(e.ClientId), e, daysInStatus, priority);
                esc.LastHandlerAlertOn = today;
            }
            // Admin escalation (priority-based threshold), repeats daily.
            if (daysInStatus >= adminThreshold(priority) && esc.LastAdminAlertOn !== today) {
                await notify(adminIds, e, daysInStatus, priority);
                esc.LastAdminAlertOn = today;
            }

            await repo.updateEscalation(e._id, esc);
            processed += 1;
        } catch (err) {
            console.error(`[escalation] failed for enquiry ${e._id}:`, err);
        }
    }

    console.log(`[escalation] processed ${processed}/${stuck.length} stuck enquiries`);
    return { processed, total: stuck.length };
}

module.exports = { runEscalations };
