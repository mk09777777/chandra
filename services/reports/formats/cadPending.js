'use strict';

const {
  COLORS, daysSince, formatDate, priorityColor,
} = require('../pdfPrimitives');

module.exports = {
  id: 'cad-pending',
  title: 'CAD Pending Report',
  layout: 'table',
  baseFilters: { status: 'Cad' },
  defaultSort: { field: 'AssignedDate', order: 'asc' },
  rowHeight: 80,
  headerRowHeight: 24,
  columns: [
    { header: '#', width: 22, align: 'center',
      render: (_row, i) => i + 1,
      textOpts: { align: 'center', color: COLORS.textMuted } },
    { header: 'Image', width: 90, align: 'center', kind: 'image' },
    { header: 'Name / Style', width: 180, kind: 'twoLine',
      primary:   (row) => row.Name || '',
      secondary: (row) => row.StyleNumber || '' },
    { header: 'Client', width: 120,
      render: (row, _i, ctx) => ctx.clientsMap[row.ClientId?.toString()] || 'N/A',
      textOpts: { fontSize: 9 } },
    { header: 'Designer', width: 110,
      render: (row, _i, ctx) => ctx.usersMap[row.AssignedTo?.toString()] || 'Unassigned',
      textOpts: { fontSize: 9 } },
    { header: 'Days Pending', width: 70, align: 'center',
      render: (row) => {
        const d = daysSince(row.AssignedDate);
        return d == null ? '—' : `${d} day${d === 1 ? '' : 's'}`;
      },
      textOpts: { align: 'center', bold: true, fontSize: 9 } },
    { header: 'Priority', width: 60, kind: 'badge',
      render: (row) => row.Priority || 'medium',
      color: (row) => priorityColor(row.Priority) },
    { header: 'Shipping Date', width: 142, align: 'center',
      render: (row) => row.ShippingDate ? formatDate(row.ShippingDate) : 'Not set',
      textOpts: { align: 'center', color: (r) => r.ShippingDate ? COLORS.text : COLORS.fallback } },
  ],
};
