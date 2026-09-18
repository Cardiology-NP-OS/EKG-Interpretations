"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CASE_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function persistImageCase(root, intakeResult) {
  requireCondition(typeof root === "string" && root.length > 0, "CASE_ROOT_REQUIRED");
  requireCondition(intakeResult && intakeResult.report && intakeResult.report.caseId, "CASE_REPORT_REQUIRED");
  requireCondition(intakeResult.report.diagnosticInterpretationIncluded !== true, "CASE_DIAGNOSIS_FORBIDDEN");
  const dir = path.resolve(root);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    schema: "ekg-image-case-v1",
    caseId: intakeResult.report.caseId,
    createdAt: "1970-01-01T00:00:00.000Z",
    report: intakeResult.report,
    digitizedLeads: intakeResult.digitized.leads.map(lead => ({
      lead: lead.lead,
      sampleRateHz: lead.sampleRateHz,
      unit: lead.unit,
      sampleCount: lead.sampleCount,
      rhythmStrip: lead.rhythmStrip,
    })),
    ...CASE_GOVERNANCE,
  };
  const file = path.join(dir, `${intakeResult.report.caseId}.json`);
  const body = `${JSON.stringify(record, null, 2)}\n`;
  fs.writeFileSync(file, body);
  return {
    schema: "ekg-image-case-receipt-v1",
    caseId: intakeResult.report.caseId,
    path: file,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    ...CASE_GOVERNANCE,
  };
}

function readImageCase(file) {
  requireCondition(typeof file === "string" && file.length > 0, "CASE_FILE_REQUIRED");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  requireCondition(record.schema === "ekg-image-case-v1", "CASE_SCHEMA");
  requireCondition(record.diagnosticInterpretationIncluded !== true, "CASE_DIAGNOSIS_FORBIDDEN");
  return record;
}

module.exports = { CASE_GOVERNANCE, persistImageCase, readImageCase };
