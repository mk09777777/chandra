const cron = require('node-cron');
const { runEscalations } = require('../services/escalation.service');

// Schedules the daily SLA-escalation pass. Operational toggles via env;
// business thresholds live (hardcoded) in escalation.service.js.
function startEscalationCron() {
    if (process.env.ESCALATION_ENABLED === 'false') {
        console.log('[escalation] cron disabled (ESCALATION_ENABLED=false)');
        return;
    }
    const expr = process.env.ESCALATION_CRON || '0 6 * * *'; // default: daily at 06:00
    const options = process.env.ESCALATION_TZ ? { timezone: process.env.ESCALATION_TZ } : {};
    cron.schedule(expr, () => {
        console.log('[escalation] cron fired');
        runEscalations().catch(err => console.error('[escalation] run failed:', err));
    }, options);
    console.log(`[escalation] cron scheduled (${expr}${process.env.ESCALATION_TZ ? `, tz=${process.env.ESCALATION_TZ}` : ''})`);
}

module.exports = { startEscalationCron };
