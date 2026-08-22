require('dotenv').config();
const mongoose = require('mongoose');
const { runEscalations } = require('../services/escalation.service');

// On-demand trigger for the SLA-escalation pass (same logic the daily cron runs).
async function run() {
    await mongoose.connect(process.env.MONGODB_URL);
    const result = await runEscalations();
    console.log('Done —', result);
    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
