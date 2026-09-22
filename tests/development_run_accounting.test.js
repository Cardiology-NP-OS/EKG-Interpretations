"use strict";

const assert = require("assert");
const { createRunAccounting, normalizeFailureCode, recordDetectorOutcome, summarizeRunAccounting } = require("../lib/development_run_accounting");

assert.equal(normalizeFailureCode(new Error("DETECTOR_TIMEOUT:secret/path")), "DETECTOR_TIMEOUT");
assert.equal(normalizeFailureCode(new Error("C:\\patient\\Jane Doe\\trace.json")), "UNCLASSIFIED_FAILURE");
assert.equal(normalizeFailureCode({ message: "line\nsecret" }), "UNCLASSIFIED_FAILURE");
assert.equal(normalizeFailureCode("VALID_CODE"), "VALID_CODE");

const manifest = {
  records: [
    { recordHmacSha256: "a".repeat(64), patientHmacSha256: "b".repeat(64), taskEligibility: "ELIGIBLE", exclusionCode: null, referenceEventCount: 4 },
    { recordHmacSha256: "c".repeat(64), patientHmacSha256: "d".repeat(64), taskEligibility: "EXCLUDED", exclusionCode: "MISSING_REFERENCE", referenceEventCount: 0 },
  ],
};
const accounting = createRunAccounting(manifest);
recordDetectorOutcome(accounting, "a".repeat(64), "CURRENT_ENGINE", "PRIMARY", { status: "SUCCESS", failureCode: null });
recordDetectorOutcome(accounting, "a".repeat(64), "CURRENT_ENGINE", "REPLAY", { status: "TECHNICAL_FAILURE", failureCode: "DETECTOR_TIMEOUT:/secret" });
recordDetectorOutcome(accounting, "a".repeat(64), "PAN_TOMPKINS", "PRIMARY", { status: "ABSTAINED", failureCode: "LOW_SIGNAL:raw detail" });
recordDetectorOutcome(accounting, "a".repeat(64), "PAN_TOMPKINS", "REPLAY", { status: "SUCCESS", failureCode: null });
const summary = summarizeRunAccounting(accounting);
assert.equal(summary.manifestRecordCount, 2);
assert.equal(summary.eligibleRecordCount, 1);
assert.equal(summary.excludedRecordCount, 1);
assert.equal(summary.rows.length, 8);
assert.equal(summary.rows.some(row => row.failureCode && row.failureCode.includes("secret")), false);
assert.equal(summary.rows.filter(row => row.status === "NOT_RUN" && row.failureCode === "MISSING_REFERENCE").length, 4);
assert.equal(summary.byDetectorAndPass.every(row => row.SUCCESS + row.TECHNICAL_FAILURE + row.ABSTAINED + row.NOT_RUN === 2), true);
assert.throws(() => recordDetectorOutcome(accounting, "a".repeat(64), "CURRENT_ENGINE", "PRIMARY", { status: "SUCCESS", failureCode: null }), /DEVELOPMENT_ACCOUNTING_DUPLICATE_OUTCOME/);
const duplicate = JSON.parse(JSON.stringify(accounting));
duplicate.rows.push({ ...duplicate.rows[0] });
assert.throws(() => summarizeRunAccounting(duplicate), /DEVELOPMENT_ACCOUNTING_ROW_COUNT/);

console.log("development run accounting tests passed");
