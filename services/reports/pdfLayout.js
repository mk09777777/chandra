'use strict';

const {
  COLORS, PAGE_MARGIN,
  drawHLine, formatDate,
} = require('./pdfPrimitives');

const BRAND = 'Chandra Jewels';

const drawTitleBlock = (doc, title, totalCount, summaryLabel = 'TOTAL ENQUIRIES') => {
  const pageW  = doc.page.width;
  const x      = PAGE_MARGIN;
  const usable = pageW - PAGE_MARGIN * 2;

  // Editorial title: brand — report name, in warm bronze.
  doc.font('Helvetica-Bold')
     .fontSize(24)
     .fillColor(COLORS.brand)
     .text(`${BRAND} — ${title}`, x, 32, {
       align: 'left',
       width: usable,
       lineBreak: false,
       ellipsis: true,
     });

  // Subtitle: generated date, muted small.
  doc.font('Helvetica')
     .fontSize(9)
     .fillColor(COLORS.textMuted)
     .text(`Generated: ${formatDate(new Date())}`, x, 62, {
       align: 'left',
       width: usable,
       lineBreak: false,
     });

  // Hairline rule under the title block.
  drawHLine(doc, x, 84, x + usable, COLORS.rowDivider, 1);

  // SECTION LABEL — navy, uppercase, letter-spaced.
  doc.font('Helvetica-Bold')
     .fontSize(9)
     .fillColor(COLORS.section)
     .text(summaryLabel.toUpperCase(), x, 98, {
       align: 'left',
       width: usable,
       characterSpacing: 1.4,
       lineBreak: false,
     });

  // Big value below the label.
  doc.font('Helvetica-Bold')
     .fontSize(18)
     .fillColor(COLORS.text)
     .text(String(totalCount), x, 112, {
       align: 'left',
       width: usable,
       lineBreak: false,
     });
};

const drawFooter = (doc, pageNumber, totalCount) => {
  const pageW   = doc.page.width;
  const footerY = doc.page.height - PAGE_MARGIN - 14;

  drawHLine(doc, PAGE_MARGIN, footerY - 6, pageW - PAGE_MARGIN, COLORS.rowDivider, 0.75);

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted);
  const usable = pageW - PAGE_MARGIN * 2;
  doc.text(`${BRAND} — Enquiry Management System`, PAGE_MARGIN, footerY, { width: usable, align: 'left',   lineBreak: false });
  doc.text(`${totalCount} records`,                     PAGE_MARGIN, footerY, { width: usable, align: 'center', lineBreak: false });
  doc.text(`Page ${pageNumber}`,                        PAGE_MARGIN, footerY, { width: usable, align: 'right',  lineBreak: false });
};

// No-op kept for backwards compatibility — the new editorial layout
// uses a hairline rule under the title instead of a coloured accent bar.
const drawTopAccentBar = () => {};

module.exports = { drawTitleBlock, drawFooter, drawTopAccentBar };
