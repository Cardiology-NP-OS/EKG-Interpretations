"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function fixture(locator) {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const input = {
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator, projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-extraction-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  return { paper, input, result, root, caseReceipt };
}

test("digitized samples persist as an immutable content-addressed extraction", () => {
  const fx = fixture("case://extract-store-1");
  const receipt = persistImageExtraction(fx.caseReceipt.path, fx.result);
  const artifact = readImageExtraction(fx.caseReceipt.path, receipt.extractionId);
  assert.ok(/^extract-[a-f0-9]{64}$/.test(receipt.extractionId));
  assert.strictEqual(artifact.caseId, fx.result.report.caseId);
  assert.strictEqual(artifact.leads.length, fx.result.digitized.leads.length);
  assert.deepStrictEqual(artifact.leads[0].samples, fx.result.digitized.leads[0].samples);
  assert.strictEqual(artifact.totalSamples, artifact.leads.reduce((n, lead) => n + lead.samples.length, 0));
  assert.strictEqual(artifact.diagnosticInterpretationIncluded, false);
  assert.strictEqual(artifact.runtimeAuthority, false);
});

test("repeating the identical extraction is idempotent", () => {
  const fx = fixture("case://extract-store-idempotent");
  const first = persistImageExtraction(fx.caseReceipt.path, fx.result);
  const second = persistImageExtraction(fx.caseReceipt.path, fx.result);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(first.extractionId, second.extractionId);
  assert.strictEqual(first.sha256, second.sha256);
  const extractionRoot = path.join(path.dirname(fx.caseReceipt.path), "extractions");
  assert.strictEqual(fs.readdirSync(extractionRoot).filter(x => x.startsWith("extract-")).length, 1);
  assert.strictEqual(fs.readdirSync(extractionRoot).filter(x => x.startsWith(".staging-")).length, 0);
});

test("changed digitized samples create a distinct extraction generation", () => {
  const fx = fixture("case://extract-store-generation");
  const first = persistImageExtraction(fx.caseReceipt.path, fx.result);
  const changed = JSON.parse(JSON.stringify(fx.result));
  changed.digitized.leads[0].samples[0] += 0.001;
  const second = persistImageExtraction(fx.caseReceipt.path, changed);
  assert.notStrictEqual(first.extractionId, second.extractionId);
  const extractionRoot = path.join(path.dirname(fx.caseReceipt.path), "extractions");
  assert.strictEqual(fs.readdirSync(extractionRoot).filter(x => x.startsWith("extract-")).length, 2);
});

test("extraction reopen rejects artifact-byte tampering", () => {
  const fx = fixture("case://extract-store-tamper");
  const receipt = persistImageExtraction(fx.caseReceipt.path, fx.result);
  fs.appendFileSync(receipt.path, " ");
  assert.throws(
    () => readImageExtraction(fx.caseReceipt.path, receipt.extractionId),
    /EXTRACTION_HASH_MISMATCH/,
  );
});

test("extraction reopen rejects hash-sidecar substitution", () => {
  const fx = fixture("case://extract-store-hash-tamper");
  const receipt = persistImageExtraction(fx.caseReceipt.path, fx.result);
  fs.writeFileSync(
    path.join(path.dirname(receipt.path), "extraction.sha256"),
    `${"0".repeat(64)}\n`,
  );
  assert.throws(
    () => readImageExtraction(fx.caseReceipt.path, receipt.extractionId),
    /EXTRACTION_HASH_MISMATCH/,
  );
});

test("an extraction cannot be attached to a different case identity", () => {
  const fx = fixture("case://extract-store-case-a");
  const other = fixture("case://extract-store-case-b");
  assert.throws(
    () => persistImageExtraction(other.caseReceipt.path, fx.result),
    /EXTRACTION_CASE_MISMATCH/,
  );
});

test("nonfinite extracted samples fail closed before persistence", () => {
  const fx = fixture("case://extract-store-nonfinite");
  const changed = {
    ...fx.result,
    digitized: {
      ...fx.result.digitized,
      leads: fx.result.digitized.leads.map((lead, index) => ({
        ...lead,
        samples: index === 0 ? lead.samples.map((v, i) => i === 0 ? Number.NaN : v) : lead.samples.slice(),
      })),
    },
  };
  assert.throws(
    () => persistImageExtraction(fx.caseReceipt.path, changed),
    /EXTRACTION_NONFINITE_SAMPLE/,
  );
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-extraction-store-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  clinicalAuthorityAdded: false,
}));
