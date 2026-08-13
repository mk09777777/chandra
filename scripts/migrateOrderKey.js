require('dotenv').config();
const mongoose = require('mongoose');
const Enquiry = require('../models/enquiry.model');

const STEP = 1000;

async function run() {
    await mongoose.connect(process.env.MONGODB_URL);

    const enquiries = await Enquiry.aggregate([
        { $match: { OrderKey: null } },
        {
            $addFields: {
                lastStatus: { $arrayElemAt: ['$StatusHistory', -1] }
            }
        },
        { $project: { _id: 1, AssignedDate: '$lastStatus.Timestamp' } }
    ]);

    enquiries.sort((a, b) => (b.AssignedDate || 0) - (a.AssignedDate || 0));

    const maxOrderKey = await Enquiry.findOne({ OrderKey: { $ne: null } }, { OrderKey: 1 })
        .sort({ OrderKey: -1 })
        .lean();
    const offset = maxOrderKey?.OrderKey ?? 0;

    const updates = enquiries.map((row, index) => ({
        updateOne: {
            filter: { _id: row._id },
            update: { $set: { OrderKey: offset + (index + 1) * STEP } }
        }
    }));

    if (updates.length) {
        await Enquiry.bulkWrite(updates);
    }

    console.log(`Done — assigned OrderKey to ${updates.length} enquiries`);
    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
