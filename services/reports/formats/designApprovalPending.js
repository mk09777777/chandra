'use strict';

const {
  COLORS,
} = require('../pdfPrimitives');

const specsPrimary = (row) => row.StoneType || '—';
const specsSecondary = (row) => {
  const color   = row.Metal?.Color   || '';
  const quality = row.Metal?.Quality || '';
  if (color && quality) return `${color} · ${quality}`;
  return color || quality || '';
};

module.exports = {
  id: 'design-approval-pending',
  title: 'Design Approval Pending Report',
  layout: 'grouped',
  baseFilters: { status: 'Design Approval Pending' },
  defaultSort: { field: 'AssignedDate', order: 'asc' },
  rowHeight: 80,
  headerRowHeight: 24,
  groupHeaderHeight: 28,

  groupBy: (row) => row.ClientId?.toString() || 'unknown',
  groupLabel: (clientId, ctx) => ctx.clientsMap[clientId] || 'Unknown Client',
  groupSort: (a, b, ctx) => {
    const la = (ctx.clientsMap[a] || '').toLowerCase();
    const lb = (ctx.clientsMap[b] || '').toLowerCase();
    return la.localeCompare(lb);
  },

  columns: [
    { header: '#', width: 22, align: 'center',
      render: (_row, i) => i + 1,
      textOpts: { align: 'center', color: COLORS.textMuted } },
    { header: 'Image', width: 90, align: 'center', kind: 'image' },
    { header: 'Name', width: 170,
      render: (row) => row.Name || '',
      textOpts: { bold: true, fontSize: 10 } },
    { header: 'Stone / Metal', width: 130, kind: 'twoLine',
      primary:   specsPrimary,
      secondary: specsSecondary },
    { header: 'Quotation', width: 382,
      render: (row) => row.LatestQuotation || '—',
      textOpts: { fontSize: 9, color: COLORS.text } },
  ],
};
