'use strict';

const PDFDocument = require('pdfkit');
const lodash = require('lodash');
const clientService = require('../client.service');
const userService = require('../user.service');

const {
  COLORS, PAGE_MARGIN, ACCENT_BAR_HEIGHT,
  getLastImageKey, fetchImageBuffer,
  drawRect, drawRoundedRect, drawHLine,
  drawCellText, drawTwoLineCell, drawBadge, drawImageCell,
} = require('./pdfPrimitives');

const { drawTitleBlock, drawFooter, drawTopAccentBar } = require('./pdfLayout');

const FORMATS = {
  'enquiries-list':           require('./formats/enquiriesList'),
  'coral-pending':            require('./formats/coralPending'),
  'cad-pending':              require('./formats/cadPending'),
  'design-approval-pending':  require('./formats/designApprovalPending'),
};

const DEFAULT_FORMAT_ID = 'enquiries-list';

function getFormat(reportType) {
  return FORMATS[reportType] || FORMATS[DEFAULT_FORMAT_ID];
}

function listFormats() {
  return Object.keys(FORMATS);
}

// ---- Column rendering ----

const colX = (format, i) =>
  PAGE_MARGIN + format.columns.slice(0, i).reduce((s, c) => s + c.width, 0);

const tableWidth = (format) =>
  format.columns.reduce((s, c) => s + c.width, 0);

const resolveTextOpts = (col, row) => {
  const opts = { ...(col.textOpts || {}) };
  if (typeof opts.color === 'function') opts.color = opts.color(row);
  if (col.align && !opts.align) opts.align = col.align;
  return opts;
};

function drawColumnHeaderRow(doc, format, y) {
  const w = tableWidth(format);
  // Light-gray header background with a thin underline.
  drawRect(doc, PAGE_MARGIN, y, w, format.headerRowHeight, COLORS.headerBg);
  format.columns.forEach((col, i) => {
    drawCellText(doc, (col.header || '').toUpperCase(), colX(format, i), y, col.width, format.headerRowHeight, {
      fontSize: 7.5, color: COLORS.headerText, bold: true,
      align: col.align || 'left',
    });
  });
  drawHLine(doc, PAGE_MARGIN, y + format.headerRowHeight, PAGE_MARGIN + w, COLORS.rowDivider, 0.75);
}

function drawDataRow(doc, format, row, rowIndex, y, ctx) {
  const w = tableWidth(format);
  const h = format.rowHeight;

  if (rowIndex % 2 === 1) {
    drawRect(doc, PAGE_MARGIN, y, w, h, COLORS.rowAlt);
  }

  format.columns.forEach((col, i) => {
    const cellX = colX(format, i);
    if (col.kind === 'image') {
      drawImageCell(doc, ctx.imageBuffers[ctx.absoluteIndex], cellX, y, col.width, h);
    } else if (col.kind === 'badge') {
      const label = col.render(row, rowIndex, ctx);
      const color = typeof col.color === 'function' ? col.color(row, ctx) : col.color;
      drawBadge(doc, label, cellX, y, col.width, h, color);
    } else if (col.kind === 'twoLine') {
      drawTwoLineCell(doc, col.primary(row, rowIndex, ctx), col.secondary(row, rowIndex, ctx), cellX, y, col.width, h);
    } else {
      const text = col.render(row, rowIndex, ctx);
      drawCellText(doc, text, cellX, y, col.width, h, resolveTextOpts(col, row));
    }
  });

  drawHLine(doc, PAGE_MARGIN, y + h, PAGE_MARGIN + w, COLORS.rowDivider, 0.5);
}

function drawGroupHeader(doc, format, label, count, y) {
  const w = tableWidth(format);

  // SECTION-style label: navy, uppercase, letter-spaced. No background block.
  doc.font('Helvetica-Bold')
     .fontSize(11)
     .fillColor(COLORS.section)
     .text((label || '').toUpperCase(), PAGE_MARGIN, y + 6, {
       width: w - 120,
       lineBreak: false,
       ellipsis: true,
       characterSpacing: 1.3,
     });

  // Right-aligned count, muted.
  doc.font('Helvetica')
     .fontSize(9)
     .fillColor(COLORS.textMuted)
     .text(`${count} ${count === 1 ? 'enquiry' : 'enquiries'}`, PAGE_MARGIN, y + 9, {
       width: w,
       align: 'right',
       lineBreak: false,
     });

  // Hairline rule beneath the section label.
  drawHLine(doc, PAGE_MARGIN, y + format.groupHeaderHeight - 2, PAGE_MARGIN + w, COLORS.rowDivider, 0.75);
}

// ---- Pagination helpers ----

function tableTopY()  { return 148; }
function pageBottom(doc) { return doc.page.height - PAGE_MARGIN - 28; }

function newPage(doc) {
  doc.addPage();
  drawTopAccentBar(doc);
}

// ---- Table layout ----

function renderTable(doc, format, rows, ctx) {
  let pageNumber = 1;
  drawTitleBlock(doc, format.title, rows.length);
  drawColumnHeaderRow(doc, format, tableTopY());
  let y = tableTopY() + format.headerRowHeight + 2;

  rows.forEach((row, i) => {
    if (y + format.rowHeight > pageBottom(doc)) {
      drawFooter(doc, pageNumber, rows.length);
      newPage(doc);
      pageNumber += 1;
      drawColumnHeaderRow(doc, format, PAGE_MARGIN + 8);
      y = PAGE_MARGIN + 8 + format.headerRowHeight + 2;
    }
    ctx.absoluteIndex = i;
    drawDataRow(doc, format, row, i, y, ctx);
    y += format.rowHeight;
  });

  drawFooter(doc, pageNumber, rows.length);
}

// ---- Grouped layout ----

function renderGrouped(doc, format, rows, ctx) {
  const groups = lodash.groupBy(rows, (r) => format.groupBy(r));
  const groupKeys = Object.keys(groups).sort((a, b) =>
    format.groupSort ? format.groupSort(a, b, ctx) : a.localeCompare(b));

  let pageNumber = 1;
  drawTitleBlock(doc, format.title, rows.length, 'PENDING APPROVALS');
  let y = tableTopY();

  // Index rows back to their position in the flat array so image lookup works
  const rowIndexMap = new Map(rows.map((r, i) => [r, i]));

  groupKeys.forEach((key) => {
    const groupRows = groups[key];
    const label = format.groupLabel(key, ctx);

    // Need room for at least the group header + 1 row
    if (y + format.groupHeaderHeight + format.rowHeight > pageBottom(doc)) {
      drawFooter(doc, pageNumber, rows.length);
      newPage(doc);
      pageNumber += 1;
      y = PAGE_MARGIN + 8;
    }

    drawGroupHeader(doc, format, label, groupRows.length, y);
    y += format.groupHeaderHeight;

    // Column headers for this section
    drawColumnHeaderRow(doc, format, y);
    y += format.headerRowHeight + 2;

    groupRows.forEach((row, localIdx) => {
      if (y + format.rowHeight > pageBottom(doc)) {
        drawFooter(doc, pageNumber, rows.length);
        newPage(doc);
        pageNumber += 1;
        // Repeat the group header label on continuation page (smaller, no card)
        drawCellText(doc, `${label} (continued)`, PAGE_MARGIN, PAGE_MARGIN + 8, tableWidth(format), 18, {
          bold: true, fontSize: 11, color: COLORS.brand, paddingX: 0,
        });
        y = PAGE_MARGIN + 8 + 22;
        drawColumnHeaderRow(doc, format, y);
        y += format.headerRowHeight + 2;
      }
      ctx.absoluteIndex = rowIndexMap.get(row);
      drawDataRow(doc, format, row, localIdx, y, ctx);
      y += format.rowHeight;
    });

    y += 12; // breathing room between groups
  });

  drawFooter(doc, pageNumber, rows.length);
}

// ---- Public API ----

async function buildReport(reportType, rows = []) {
  const startTime = Date.now();
  const format = getFormat(reportType);
  console.log(`[PDF] Building '${format.id}' report — ${rows.length} rows`);

  const [clients, users] = await Promise.all([
    clientService.getClients(),
    userService.getUsers(),
  ]);

  const clientsMap = Object.fromEntries(clients.map((c) => [c._id.toString(), c.Name]));
  const usersMap   = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

  const imageBuffers = await Promise.all(rows.map((r) => fetchImageBuffer(getLastImageKey(r))));
  const imageCount   = imageBuffers.filter(Boolean).length;
  console.log(`[PDF] Fetched ${imageCount}/${rows.length} images`);

  const ctx = { clientsMap, usersMap, imageBuffers, absoluteIndex: 0 };

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: PAGE_MARGIN,
    autoFirstPage: true,
  });

  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on('data',  (c)   => chunks.push(c));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));
  });

  if (format.layout === 'grouped') {
    renderGrouped(doc, format, rows, ctx);
  } else {
    renderTable(doc, format, rows, ctx);
  }

  doc.end();
  const buffer = await done;
  console.log(`[PDF] Done in ${Date.now() - startTime}ms — ${(buffer.length / 1024).toFixed(1)} KB`);
  return buffer;
}

module.exports = { buildReport, getFormat, listFormats };
