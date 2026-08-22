require('dotenv').config();
const mongoose = require('mongoose');
const Enquiry = require('../models/enquiry.model');
const Codelist = require('../models/codelists.model');

// Local copy of services/enquiry.service.js#deriveCostSubStatus (not exported there).
function deriveCostSubStatus(asset) {
    const p = Array.isArray(asset?.Pricing) ? asset.Pricing[0] : null;
    if (!p) return 'Cost Missing';
    const stones = p.Stones || [];
    const stonesPriced = stones.length > 0 && stones.every(s => Number(s.Price) > 0);
    const metalPriced = Number(p.MetalPrice) > 0;
    return (stonesPriced && metalPriced) ? 'Quotation Review' : 'Cost Missing';
}

// Decide whether a retired 'Quotation' entry was a Coral or Cad upload.
// Prefer the entry's own Details prefix; fall back to the document's arrays.
function inferType(entry, enquiry) {
    const d = (entry.Details || '').toLowerCase();
    if (d.startsWith('coral')) return 'coral';
    if (d.startsWith('cad')) return 'cad';
    if (Array.isArray(enquiry.Cad) && enquiry.Cad.length > 0) return 'cad';
    return 'coral';
}

async function run() {
    await mongoose.connect(process.env.MONGODB_URL);

    // Documents carrying either a retired 'Quotation' status or a legacy uppercase 'CAD' status.
    const enquiries = await Enquiry.find({ 'StatusHistory.Status': { $in: ['Quotation', 'CAD'] } });
    let docsTouched = 0, quotationRewritten = 0, cadRewritten = 0;

    for (const enquiry of enquiries) {
        let changed = false;

        for (const entry of enquiry.StatusHistory) {
            // Retired 'Quotation' status → infer Coral/Cad + derive sub-status.
            if (entry.Status === 'Quotation') {
                const type = inferType(entry, enquiry);
                const arr = type === 'cad' ? enquiry.Cad : enquiry.Coral;
                const asset = Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null;

                entry.Status = type === 'cad' ? 'Cad' : 'Coral';
                entry.SubStatus = deriveCostSubStatus(asset);
                quotationRewritten++;
                changed = true;
            }
            // Legacy uppercase 'CAD' → canonical 'Cad' (leave SubStatus as-is).
            else if (entry.Status === 'CAD') {
                entry.Status = 'Cad';
                cadRewritten++;
                changed = true;
            }
        }

        if (changed) {
            await enquiry.save();
            docsTouched++;
            console.log(`Migrated enquiry ${enquiry._id} — current status now "${enquiry.StatusHistory.at(-1)?.Status}" / "${enquiry.StatusHistory.at(-1)?.SubStatus}"`);
        }
    }

    // Fix the live Status codelist value 'CAD' → 'Cad' (no-op if absent / already correct).
    const codelistRes = await Codelist.updateOne(
        { Type: 'Status', 'Values.Name': 'CAD' },
        { $set: { 'Values.$.Name': 'Cad' } }
    );

    console.log(`Done — enquiries touched: ${docsTouched}, 'Quotation' entries rewritten: ${quotationRewritten}, 'CAD' entries rewritten: ${cadRewritten}, Status codelist updated: ${codelistRes.modifiedCount}`);
    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
