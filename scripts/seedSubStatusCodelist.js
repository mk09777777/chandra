require('dotenv').config();
const mongoose = require('mongoose');
const Codelist = require('../models/codelists.model');
const { createSubStatusCodelist } = require('../utils/populateCodelists');

// Seeds the 'SubStatus' codelist (L2 stages under the Coral/Cad phase).
// Safe to re-run: skips if a SubStatus codelist already exists.
async function run() {
    await mongoose.connect(process.env.MONGODB_URL);

    const existing = await Codelist.findOne({ Type: 'SubStatus' });
    if (existing) {
        console.log("SubStatus codelist already exists — skipping seed.");
    } else {
        await createSubStatusCodelist();
    }

    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
