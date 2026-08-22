'use strict';

const https = require('https');
const http = require('http');
const sharp = require('sharp');
const { generatePresignedUrl } = require('../../utils/s3');

// ---- Design tokens ----

const COLORS = {
  brand:        '#8B6135',  // warm bronze — title
  section:      '#1F2A44',  // dark navy — SECTION LABELS, table header text
  headerBg:     '#F3F4F6',  // light gray — table header background
  headerText:   '#1F2A44',  // dark navy — table header text
  rowAlt:       '#FAFBFC',  // very subtle zebra
  rowDivider:   '#E5E7EB',
  highlight:    '#FFF8EE',  // cream — emphasis card
  text:         '#111827',
  textMuted:    '#6B7280',
  fallback:     '#9CA3AF',
  brandAccent:  '#B8884E',  // lighter bronze accent
};

const STATUS_COLORS = {
  pending:   '#B45309',  // amber-700 (darker for soft-tint readability)
  completed: '#047857',  // emerald-700
  rejected:  '#B91C1C',  // red-700
};

const PRIORITY_COLORS = {
  low:    '#047857',
  medium: '#B45309',
  high:   '#B91C1C',
  urgent: '#B91C1C',
};

// Lighten a hex toward white. amount=0..1 (higher = lighter).
const tint = (hex, amount = 0.82) => {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
};

const PAGE_MARGIN = 24;
const ACCENT_BAR_HEIGHT = 4;

// ---- Formatting helpers ----

const formatDate = (date) => {
  if (!date) return 'N/A';
  try {
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return 'N/A';
  }
};

const formatMetal = (metal) => {
  if (!metal) return '';
  const color   = metal.Color   || '';
  const quality = metal.Quality || '';
  if (color && quality) return `${color} (${quality})`;
  return color || quality;
};

const statusColor = (status) =>
  STATUS_COLORS[(status || '').toLowerCase()] || COLORS.fallback;

const priorityColor = (priority) => {
  const p = (priority || '').toLowerCase();
  if (p === 'urgent' || p === 'high' || p.includes('super')) return PRIORITY_COLORS.high;
  return PRIORITY_COLORS[p] || COLORS.fallback;
};

const daysSince = (date) => {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.floor(diff / 86400000));
};

// ---- Image fetching ----

const getLastImageKey = (enquiry) => {
  const images = enquiry?.ReferenceImages;
  if (!Array.isArray(images) || images.length === 0) return null;
  const last = images[images.length - 1];
  return last?.Key || last?.key || last?.KeyName || last?.keyName || null;
};

const fetchImageBuffer = async (imageKey) => {
  if (!imageKey) return null;

  let presignedUrl;
  try {
    presignedUrl = await generatePresignedUrl(imageKey, 'inline');
  } catch {
    console.warn(`[PDF] Failed to get presigned URL for ${imageKey}`);
    return null;
  }

  return new Promise((resolve) => {
    const url    = new URL(presignedUrl);
    const client = url.protocol === 'https:' ? https : http;

    client.get(presignedUrl, (response) => {
      if (response.statusCode !== 200) {
        console.warn(`[PDF] Image ${imageKey} responded ${response.statusCode}`);
        resolve(null);
        return;
      }

      const contentType = response.headers['content-type'] || '';
      if (!contentType.startsWith('image/')) {
        console.warn(`[PDF] Skipping non-image ${imageKey} (${contentType})`);
        response.destroy();
        resolve(null);
        return;
      }

      const MAX_SIZE = 5 * 1024 * 1024;
      const chunks   = [];
      let totalSize  = 0;

      response.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_SIZE) {
          response.destroy();
          console.warn(`[PDF] Image ${imageKey} exceeds 5MB, skipping`);
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', async () => {
        try {
          const buffer  = Buffer.concat(chunks);
          const resized = await sharp(buffer)
            .resize(160, 160, { fit: 'cover', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          resolve(resized);
        } catch (err) {
          console.warn(`[PDF] Sharp failed for ${imageKey}:`, err.message);
          resolve(null);
        }
      });

      response.on('error', (err) => {
        console.warn(`[PDF] Stream error for ${imageKey}:`, err.message);
        resolve(null);
      });
    }).on('error', (err) => {
      console.warn(`[PDF] Request error for ${imageKey}:`, err.message);
      resolve(null);
    });
  });
};

// ---- Drawing primitives ----

const drawRect = (doc, x, y, w, h, fill, stroke) => {
  doc.rect(x, y, w, h);
  if (fill && stroke) doc.fillAndStroke(fill, stroke);
  else if (fill)      doc.fill(fill);
  else if (stroke)    doc.stroke(stroke);
};

const drawRoundedRect = (doc, x, y, w, h, r, fill, stroke) => {
  doc.roundedRect(x, y, w, h, r);
  if (fill && stroke) doc.fillAndStroke(fill, stroke);
  else if (fill)      doc.fill(fill);
  else if (stroke)    doc.stroke(stroke);
};

const drawHLine = (doc, x1, y, x2, color, width = 0.5) => {
  doc.save();
  doc.lineWidth(width).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke();
  doc.restore();
};

const drawCellText = (doc, text, x, y, w, h, opts = {}) => {
  const {
    fontSize = 8,
    color    = COLORS.text,
    align    = 'left',
    bold     = false,
    paddingX = 4,
    paddingY = 4,
  } = opts;

  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(fontSize)
     .fillColor(color);

  const innerX = x + paddingX;
  const innerW = w - paddingX * 2;
  const textHeight = doc.heightOfString(String(text ?? ''), { width: innerW, align });
  const innerY = y + Math.max(paddingY, (h - textHeight) / 2);

  doc.text(String(text ?? ''), innerX, innerY, {
    width: innerW,
    align,
    ellipsis: true,
    lineBreak: true,
    height: h - paddingY * 2,
  });
};

const drawTwoLineCell = (doc, primary, secondary, x, y, w, h, opts = {}) => {
  const { paddingX = 4 } = opts;
  const innerX = x + paddingX;
  const innerW = w - paddingX * 2;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text);
  const primH = doc.heightOfString(String(primary ?? ''), { width: innerW });

  doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted);
  const secH = secondary ? doc.heightOfString(String(secondary), { width: innerW }) : 0;

  const totalH = primH + (secondary ? secH + 2 : 0);
  const topY = y + Math.max(4, (h - totalH) / 2);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
     .text(String(primary ?? ''), innerX, topY, {
       width: innerW, ellipsis: true, lineBreak: true, height: primH,
     });

  if (secondary) {
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.textMuted)
       .text(String(secondary), innerX, topY + primH + 2, {
         width: innerW, ellipsis: true, lineBreak: true, height: secH,
       });
  }
};

const drawBadge = (doc, text, x, y, w, h, color) => {
  const label   = String(text ?? '').toUpperCase();
  const badgeH  = 14;
  const padding = 8;

  doc.font('Helvetica-Bold').fontSize(6.5);
  const textW  = doc.widthOfString(label);
  const badgeW = Math.min(w - 6, textW + padding * 2);
  const badgeX = x + (w - badgeW) / 2;
  const badgeY = y + (h - badgeH) / 2;

  // Soft pill: tinted background, full-color text.
  drawRoundedRect(doc, badgeX, badgeY, badgeW, badgeH, 7, tint(color, 0.85));
  doc.fillColor(color)
     .text(label, badgeX, badgeY + 4, {
       width: badgeW,
       align: 'center',
       lineBreak: false,
     });
};

const drawImageCell = (doc, imgBuffer, x, y, w, h) => {
  if (!imgBuffer) {
    drawCellText(doc, '—', x, y, w, h, { align: 'center', color: COLORS.fallback, fontSize: 10 });
    return;
  }
  const size = Math.min(w - 8, h - 8);
  const imgX = x + (w - size) / 2;
  const imgY = y + (h - size) / 2;
  try {
    doc.save();
    doc.roundedRect(imgX, imgY, size, size, 4).clip();
    doc.image(imgBuffer, imgX, imgY, { width: size, height: size });
    doc.restore();
    drawRoundedRect(doc, imgX, imgY, size, size, 4, null, COLORS.rowDivider);
  } catch (err) {
    console.warn('[PDF] Failed to embed image:', err.message);
    drawCellText(doc, '—', x, y, w, h, { align: 'center', color: COLORS.fallback, fontSize: 10 });
  }
};

module.exports = {
  COLORS,
  STATUS_COLORS,
  PRIORITY_COLORS,
  PAGE_MARGIN,
  ACCENT_BAR_HEIGHT,
  tint,
  formatDate,
  formatMetal,
  statusColor,
  priorityColor,
  daysSince,
  getLastImageKey,
  fetchImageBuffer,
  drawRect,
  drawRoundedRect,
  drawHLine,
  drawCellText,
  drawTwoLineCell,
  drawBadge,
  drawImageCell,
};
