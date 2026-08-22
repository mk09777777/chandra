const Codelist = require('../models/codelists.model'); // Adjust path as necessary

// async function createRolesCodelist() {
//     // 1. Define the values you want to insert
//     const roleValues = [
//         { Id: 1, Code: 'AD', Name: 'Admin' },
//         { Id: 2, Code: 'CO', Name: 'Coral' },
//         { Id: 3, Code: 'CD', Name: 'Cad' },
//         { Id: 4, Code: 'CL', Name: 'Client' },
//         { Id: 5, Code: 'CH', Name: 'Client Handler' }
//     ];

//     try {
//         // 2. Create a new document using the Codelist model
//         const newCodelist = new Codelist({
//             Type: 'Roles', 
//             Values: roleValues 
//         });

//         // 3. Save the document to MongoDB
//         const result = await newCodelist.save();
//         console.log("Successfully created Codelist for 'Roles':", result);

//     } catch (err) {
//         console.error("Error creating Codelist:", err);
//     }
// }

// exports.createRolesCodelist = createRolesCodelist;


// async function createStatusCodelist() {
//     const statusValues = [
//         {
//             "Id": 1,
//             "Code": "EC",
//             "Name": "Enquiry Created"
//         },
//         {
//             "Id": 4,
//             "Code": "CO",
//             "Name": "Coral"
//         },
//         {
//             "Id": 7,
//             "Code": "CD",
//             "Name": "Cad"
//         },
//         {
//             "Id": 10,
//             "Code": "AC",
//             "Name": "Approved Cad"
//         },
//         {
//             "Id": 13,
//             "Code": "DAP",
//             "Name": "Design Approval Pending"
//         },
//         {
//             "Id": 16,
//             "Code": "OP",
//             "Name": "Order Placement"
//         },
//         {
//             "Id": 19,
//             "Code": "CAMP",
//             "Name": "CAM Pending"
//         },
//         {
//             "Id": 22,
//             "Code": "PROD",
//             "Name": "Production"
//         },
//         {
//             "Id": 25,
//             "Code": "SHIP",
//             "Name": "Shipped"
//         },
//         {
//             "Id": 28,
//             "Code": "COMP",
//             "Name": "Completed"
//         }
//     ];

//     try {
//         const newCodelist = new Codelist({
//             Type: 'Status',
//             Values: statusValues
//         });

//         const result = await newCodelist.save();
//         console.log("Successfully created Codelist for 'Status':", result);

//     } catch (err) {
//         console.error("Error creating Codelist:", err);
//     }
// }

// async function createStoneTypesCodelist() {
//     const stoneTypeValues = [
//         { Id: 1, Code: 'LabGrown', Name: 'LabGrown' },
//         { Id: 2, Code: 'CVDLabGrown', Name: 'CVDLabGrown' },
//         { Id: 3, Code: 'NaturalRegular', Name: 'NaturalRegular' },
//         { Id: 4, Code: 'NaturalLower', Name: 'NaturalLower' },
//         { Id: 5, Code: 'Synthetic', Name: 'Synthetic' },
//         { Id: 6, Code: 'LabTreatedDiamond', Name: 'LabTreatedDiamond' },
//         { Id: 7, Code: 'ColoredLabTreatedNaturalDiamond', Name: 'ColoredLabTreatedNaturalDiamond' },
//         { Id: 8, Code: 'TYPE1', Name: 'TYPE 1' },
//         { Id: 9, Code: 'TYPE2', Name: 'TYPE 2' },
//         { Id: 10, Code: 'TYPE3', Name: 'TYPE 3' },
//     ];

//     try {
//         const newCodelist = new Codelist({
//             Type: 'StoneTypes',
//             Values: stoneTypeValues
//         });

//         const result = await newCodelist.save();
//         console.log("Successfully created Codelist for 'StoneTypes':", result);
//     } catch (err) {
//         console.error("Error creating StoneTypes Codelist:", err);
//     }
// }

// exports.createStoneTypesCodelist = createStoneTypesCodelist;

// L2 sub-statuses under the Coral/Cad phase. Run once, then comment out.
async function createSubStatusCodelist() {
    const subStatusValues = [
        { Id: 1, Code: 'AP', Name: 'Assign Pending' },
        { Id: 2, Code: 'AS', Name: 'Assigned' },
        { Id: 3, Code: 'RR', Name: 'Rejected - Redo' },
        { Id: 4, Code: 'DS', Name: 'Design Submitted' },
        { Id: 5, Code: 'CM', Name: 'Cost Missing' },
        { Id: 6, Code: 'QR', Name: 'Quotation Review' },
    ];

    try {
        const newCodelist = new Codelist({
            Type: 'SubStatus',
            Values: subStatusValues
        });

        const result = await newCodelist.save();
        console.log("Successfully created Codelist for 'SubStatus':", result);
    } catch (err) {
        console.error("Error creating SubStatus Codelist:", err);
    }
}

exports.createSubStatusCodelist = createSubStatusCodelist;

async function createStoneShapesCodelist() {
    const values = [
        { Id: 1,  Code: 'RD', Name: 'Round' },
        { Id: 2,  Code: 'OV', Name: 'Oval' },
        { Id: 3,  Code: 'EM', Name: 'Emerald' },
        { Id: 4,  Code: 'PS', Name: 'Pear' },
        { Id: 5,  Code: 'PR', Name: 'Princess' },
        { Id: 6,  Code: 'CU', Name: 'Cushion' },
        { Id: 7,  Code: 'MQ', Name: 'Marquise' },
        { Id: 8,  Code: 'RA', Name: 'Radiant' },
        { Id: 9,  Code: 'AS', Name: 'Asscher' },
        { Id: 10, Code: 'HT', Name: 'Heart' },
        { Id: 11, Code: 'BG', Name: 'Baguette' },
        { Id: 12, Code: 'TB', Name: 'Tapered Baguette' },
        { Id: 13, Code: 'TR', Name: 'Trillion' },
        { Id: 14, Code: 'HM', Name: 'Half Moon' },
        { Id: 15, Code: 'SQ', Name: 'Square' },
    ];

    try {
        const newCodelist = new Codelist({
            Type: 'StoneShapes',
            Values: values
        });
        const result = await newCodelist.save();
        console.log("Successfully created Codelist for 'StoneShapes':", result);
    } catch (err) {
        console.error("Error creating StoneShapes Codelist:", err);
    }
}

exports.createStoneShapesCodelist = createStoneShapesCodelist;
