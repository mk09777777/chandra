require('dotenv').config();
const mongoose = require('mongoose');
const Enquiry = require('../models/enquiry.model');

async function run() {
    await mongoose.connect(process.env.MONGODB_URL);

    const enquiries = await Enquiry.collection.find(
        { $or: [{ StoneType: { $exists: true } }, { 'Metal.Quality': { $exists: true } }] },
        { projection: { StoneType: 1, StoneTypes: 1, 'Metal.Quality': 1, 'Metal.Qualities': 1 } }
    ).toArray();

    const updates = [];
    for (const row of enquiries) {
        const set = {};

        if (row.StoneType && !(Array.isArray(row.StoneTypes) && row.StoneTypes.length)) {
            set.StoneTypes = [row.StoneType];
        }
        if (row.Metal?.Quality && !(Array.isArray(row.Metal?.Qualities) && row.Metal.Qualities.length)) {
            set['Metal.Qualities'] = [row.Metal.Quality];
        }

        updates.push({
            updateOne: {
                filter: { _id: row._id },
                update: {
                    ...(Object.keys(set).length ? { $set: set } : {}),
                    $unset: { StoneType: '', 'Metal.Quality': '' }
                }
            }
        });
    }

    if (updates.length) {
        await Enquiry.collection.bulkWrite(updates);
    }

    console.log(`Done — migrated ${updates.length} enquiries`);
    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
