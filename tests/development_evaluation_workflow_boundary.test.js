"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "development_evaluation.yml"), "utf8");
const watchdog = fs.readFileSync(path.join(root, ".github", "workflows", "development_evaluation_watchdog.yml"), "utf8");
const runner = fs.readFileSync(path.join(root, "lib", "development_evaluation_runner.js"), "utf8");
const combinedExecutableSurface = `${workflow}\n${runner}`;
const prohibited = [
  "run_mitbih_rpeak_pilot.py",
  "run_mitbih_rpeak_full.py",
  "run_ludb_qrs_v2_dev.py",
  "run_ludb_qrs_v2_coverage_v2_dev.py",
  "run_ludb_qrs_v2_coverage_v2_holdout.py",
  "clinical_accuracy_pilot.yml",
  "validate:qrs-v2-ludb-train",
  "validate:qrs-v2-ludb-coverage-v2-train",
  "validate:qrs-v2-ludb-coverage-v2-holdout",
];
for (const value of prohibited) assert.equal(combinedExecutableSurface.includes(value), false, `prohibited executable reference: ${value}`);
assert.match(workflow, /schedule:/);
assert.match(workflow, /push:/);
assert.match(workflow, /runs-on: \[self-hosted, linux, x64, ecg-development\]/);
assert.match(workflow, /EKG_EVALUATION_NETWORK_DISABLED/);
assert.match(workflow, /APPLICATION_WRITE_ONCE_SIGNED/);
assert.match(workflow, /manifest-trust-store\.json/);
assert.match(workflow, /EKG_DEVELOPMENT_MANIFEST_TRUST_STORE_SHA256/);
assert.match(workflow, /expectedManifestTrustStoreSha256/);
assert.match(workflow, /partition-index\.json/);
assert.match(workflow, /partitionIndexPath/);
assert.match(workflow, /candidate-manifest\.json/);
assert.match(workflow, /candidate-manifest\.sig\.json/);
assert.match(workflow, /candidate-trust-store\.json/);
assert.match(workflow, /EKG_DEVELOPMENT_CANDIDATE_TRUST_STORE_SHA256/);
assert.match(workflow, /expectedCandidateTrustStoreSha256/);
assert.match(workflow, /previousBundleSignerKeyId/);
assert.match(workflow, /environmentImageDigest/);
assert.match(workflow, /--network none/);
assert.match(workflow, /node:22@sha256:/);
assert.match(workflow, /weekly\?10000:2000/);
assert.match(workflow, /EKG_EVALUATION_SIGNING_KEY_FILE/);
assert.equal(workflow.includes("--env EKG_EVALUATION_SIGNING_KEY_PEM_BASE64"), false);
assert.match(watchdog, /--event schedule/);
assert.match(watchdog, /--limit 20/);
assert.match(watchdog, /rows\.some/);
assert.match(watchdog, /30\*60\*60\*1000/);
assert.match(watchdog, /issue create/);
console.log("development evaluation workflow boundary tests passed");
