"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { detectCandidateRPeaksV2 } = require("../lib/qrs_detector_v2");
const { detectCandidateRPeaksMultiLeadV2 } = require("../lib/qrs_multilead_v2");
const { matchEventsV2 } = require("../lib/event_matcher_v2");
const holdoutReceipt = require("../validation/development/results/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1_RECEIPT.json");
const { fixtureById, manifest } = require("../validation/development/qrs_v2_post_holdout_synthetic_corpus");

const root = path.join(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function sha256File(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

function score(referenceSampleIndices, events) {
  return matchEventsV2(referenceSampleIndices, events, { toleranceSamples: 16 });
}

test("post-holdout fixtures bind the spent result without importing holdout details", () => {
  assert.strictEqual(manifest.lineage.holdout_result_id, holdoutReceipt.result_id);
  assert.strictEqual(manifest.lineage.holdout_receipt_sha256, sha256File(manifest.lineage.holdout_receipt));
  assert.strictEqual(holdoutReceipt.dataset.holdout_now_consumed, true);
  assert.strictEqual(holdoutReceipt.decision.post_holdout_tuning_on_this_split_allowed, false);
  assert.strictEqual(manifest.generator.real_signal_or_annotation_bytes_used, false);
  assert.strictEqual(manifest.generator.holdout_record_ids_or_sample_indices_used, false);
  assert.strictEqual(manifest.generator.locked_mitbih_signals_or_labels_used, false);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /ludb\//i);
  assert.doesNotMatch(serialized, /recordId|sampleIndex/i);
});

test("frozen detector configuration and multilead implementation are unchanged", () => {
  assert.strictEqual(manifest.frozen_candidate.detector_implementation_sha256, sha256File("lib/qrs_detector_v2.js"));
  assert.strictEqual(manifest.frozen_candidate.multilead_implementation_sha256, sha256File("lib/qrs_multilead_v2.js"));
  assert.strictEqual(manifest.frozen_candidate.configuration_sha256, sha256File("evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json"));
  assert.strictEqual(manifest.frozen_candidate.implementation_or_parameter_change, false);
});

for (const spec of manifest.fixtures) {
  test(`${spec.id} reproduces the frozen current-candidate limitation exactly`, () => {
    const fixture = fixtureById(spec.id);
    const output = detectCandidateRPeaksMultiLeadV2(fixture.leads, fixture.sampleRateHz, { provenance: fixture.provenance });
    const matching = score(fixture.referenceSampleIndices, output.detection.events);
    assert.strictEqual(output.selectedLeadName, fixture.expectedFrozenCandidate.selected_lead);
    assert.strictEqual(matching.matchedCount, fixture.expectedFrozenCandidate.matched);
    assert.strictEqual(matching.falsePositiveCount, fixture.expectedFrozenCandidate.false_positive);
    assert.strictEqual(matching.falseNegativeCount, fixture.expectedFrozenCandidate.false_negative);
    assert.strictEqual(output.diagnosticRuntime, "GOVERNED_INACTIVE");
    assert.strictEqual(output.metrics, "NOT_REPORTABLE");
  });

  test(`${spec.id} isolates cleanly to the alternate synthetic lead`, () => {
    const fixture = fixtureById(spec.id);
    const alternate = fixture.leads.find(row => row.leadName === fixture.expectedAlternateLeadIsolation.lead_name);
    const output = detectCandidateRPeaksV2(alternate.samples, fixture.sampleRateHz, { provenance: fixture.provenance });
    const matching = score(fixture.referenceSampleIndices, output.events);
    assert.strictEqual(matching.matchedCount, fixture.expectedAlternateLeadIsolation.matched);
    assert.strictEqual(matching.falsePositiveCount, fixture.expectedAlternateLeadIsolation.false_positive);
    assert.strictEqual(matching.falseNegativeCount, fixture.expectedAlternateLeadIsolation.false_negative);
  });
}

test("characterization cannot claim candidate pass or clinical authority", () => {
  assert.strictEqual(manifest.state, "FROZEN_KNOWN_LIMITATION_CHARACTERIZATION_ONLY");
  assert.strictEqual(manifest.interpretation.current_candidate_pass_claimed, false);
  assert.strictEqual(manifest.interpretation.clinical_failure_mechanism_claimed, false);
  assert.strictEqual(manifest.interpretation.future_configuration_acceptance_defined, false);
  assert.strictEqual(manifest.authority.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(manifest.authority.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(manifest.authority.metrics, "NOT_REPORTABLE");
  assert.strictEqual(manifest.authority.activation, "NOT_ELIGIBLE");
  assert.strictEqual(manifest.authority.clinical_validity_inferred, false);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-qrs-v2-post-holdout-synthetic-characterization-tests-v1",
  pass: true,
  passed,
  total: passed,
  fixtureSetId: manifest.fixture_set_id,
  knownLimitationsCharacterized: manifest.fixtures.length,
  detectorChanged: false,
  holdoutReused: false,
  lockedMitbihAccessed: false,
  clinicalAuthorityAdded: false,
}));
