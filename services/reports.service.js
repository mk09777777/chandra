'use strict';

// Thin shim for backwards compatibility. New code should require
// './reports' directly (the orchestrator) and call buildReport(reportType, rows).

const orchestrator = require('./reports');

async function buildEnquiryPdf(rows = [], reportType = 'enquiries-list') {
  return orchestrator.buildReport(reportType, rows);
}

module.exports = {
  buildEnquiryPdf,
  buildReport: orchestrator.buildReport,
  getFormat:   orchestrator.getFormat,
  listFormats: orchestrator.listFormats,
};
