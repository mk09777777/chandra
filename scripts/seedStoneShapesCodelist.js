require('dotenv').config();
const mongoose = require('mongoose');
const Codelist = require('../models/codelists.model');
const { createStoneShapesCodelist } = require('../utils/populateCodelists');

async function run() {
    await mongoose.connect(process.env.MONGODB_URL);

    const existing = await Codelist.findOne({ Type: 'StoneShapes' });
    if (existing) {
        console.log("StoneShapes codelist already exists — skipping seed.");
    } else {
        await createStoneShapesCodelist();
    }

    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
