"use strict";

const DETECTORS = Object.freeze(["CURRENT_ENGINE", "PAN_TOMPKINS"]);
const PASSES = Object.freeze(["PRIMARY", "REPLAY"]);
const TERMINAL_STATUSES = Object.freeze(["SUCCESS", "TECHNICAL_FAILURE", "ABSTAINED", "NOT_RUN"]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function normalizeFailureCode(value, fallback = "UNCLASSIFIED_FAILURE") {
  requireCondition(/^[A-Z][A-Z0-9_]{2,63}$/.test(fallback), "DEVELOPMENT_FAILURE_FALLBACK");
  const message = typeof value === "string" ? value : value && typeof value.message === "string" ? value.message : "";
  const match = /^([A-Z][A-Z0-9_]{2,63})(?::|$)/.exec(message);
  return match ? match[1] : fallback;
}

function createRunAccounting(manifest) {
  requireCondition(manifest && Array.isArray(manifest.records), "DEVELOPMENT_ACCOUNTING_MANIFEST");
  const rows = [];
  for (const record of manifest.records) {
    const eligible = record.taskEligibility === "ELIGIBLE";
    const exclusionCode = eligible ? null : normalizeFailureCode(record.exclusionCode, "MANIFEST_EXCLUDED");
    for (const detector of DETECTORS) {
      for (const pass of PASSES) {
        rows.push({
          recordHmacSha256: record.recordHmacSha256,
          patientHmacSha256: record.patientHmacSha256,
          taskEligibility: record.taskEligibility,
          referenceEventCount: record.referenceEventCount,
          detector,
          pass,
          status: "NOT_RUN",
          failureCode: eligible ? "NOT_ATTEMPTED" : exclusionCode,
        });
      }
    }
  }
  return {
    schema: "ekg-development-run-accounting-v1",
    manifestRecordCount: manifest.records.length,
    eligibleRecordCount: manifest.records.filter(record => record.taskEligibility === "ELIGIBLE").length,
    excludedRecordCount: manifest.records.filter(record => record.taskEligibility !== "ELIGIBLE").length,
    rows,
    clinicalAccuracyClaimed: false,
    capabilityNotClaim: true,
  };
}

function recordDetectorOutcome(accounting, recordHmacSha256, detector, pass, result) {
  requireCondition(accounting && Array.isArray(accounting.rows), "DEVELOPMENT_ACCOUNTING_REQUIRED");
  requireCondition(DETECTORS.includes(detector), "DEVELOPMENT_ACCOUNTING_DETECTOR");
  requireCondition(PASSES.includes(pass), "DEVELOPMENT_ACCOUNTING_PASS");
  requireCondition(result && TERMINAL_STATUSES.includes(result.status) && result.status !== "NOT_RUN", "DEVELOPMENT_ACCOUNTING_STATUS");
  const matches = accounting.rows.filter(row => row.recordHmacSha256 === recordHmacSha256 && row.detector === detector && row.pass === pass);
  requireCondition(matches.length === 1, "DEVELOPMENT_ACCOUNTING_ROW_IDENTITY");
  const row = matches[0];
  requireCondition(row.taskEligibility === "ELIGIBLE", "DEVELOPMENT_ACCOUNTING_EXCLUDED_ATTEMPT");
  requireCondition(row.status === "NOT_RUN" && row.failureCode === "NOT_ATTEMPTED", "DEVELOPMENT_ACCOUNTING_DUPLICATE_OUTCOME");
  row.status = result.status;
  row.failureCode = result.status === "SUCCESS" ? null : normalizeFailureCode(result.failureCode, result.status === "ABSTAINED" ? "DETECTOR_ABSTAINED" : "DETECTOR_FAILURE");
}

function summarizeRunAccounting(accounting) {
  requireCondition(accounting && Array.isArray(accounting.rows), "DEVELOPMENT_ACCOUNTING_REQUIRED");
  requireCondition(accounting.manifestRecordCount === accounting.eligibleRecordCount + accounting.excludedRecordCount, "DEVELOPMENT_ACCOUNTING_MANIFEST_RECONCILIATION");
  requireCondition(accounting.rows.length === accounting.manifestRecordCount * DETECTORS.length * PASSES.length, "DEVELOPMENT_ACCOUNTING_ROW_COUNT");
  const identities = new Set();
  for (const row of accounting.rows) {
    requireCondition(DETECTORS.includes(row.detector) && PASSES.includes(row.pass) && TERMINAL_STATUSES.includes(row.status), "DEVELOPMENT_ACCOUNTING_ROW");
    const identity = `${row.recordHmacSha256}:${row.detector}:${row.pass}`;
    requireCondition(!identities.has(identity), "DEVELOPMENT_ACCOUNTING_DUPLICATE_ROW");
    identities.add(identity);
    requireCondition(row.status === "SUCCESS" ? row.failureCode === null : typeof row.failureCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(row.failureCode), "DEVELOPMENT_ACCOUNTING_FAILURE_CODE");
  }
  const byDetectorAndPass = [];
  for (const detector of DETECTORS) {
    for (const pass of PASSES) {
      const rows = accounting.rows.filter(row => row.detector === detector && row.pass === pass);
      const counts = Object.fromEntries(TERMINAL_STATUSES.map(status => [status, rows.filter(row => row.status === status).length]));
      requireCondition(Object.values(counts).reduce((sum, count) => sum + count, 0) === accounting.manifestRecordCount, "DEVELOPMENT_ACCOUNTING_TERMINAL_RECONCILIATION");
      byDetectorAndPass.push({ detector, pass, ...counts });
    }
  }
  return { ...accounting, byDetectorAndPass };
}

module.exports = { DETECTORS, PASSES, TERMINAL_STATUSES, createRunAccounting, normalizeFailureCode, recordDetectorOutcome, summarizeRunAccounting };
