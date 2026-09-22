"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { persistImageAnalysis, readImageAnalysis, auditImageAnalysis } = require("../lib/image_analysis_store");

const repo = path.resolve(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-analysis-provenance-"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

try {
  const paper = renderPaperEcgRaster({ leads: syntheticLeadMap(250, 10), sampleRateHz: 250, geometry: { pxPerMm: 5 } });
  const input = {
    sourceKind: "synthetic_raster", format: "raster_matrix", raster: paper.image, expectedRois: paper.rois,
    roiLeadIdentityVerified: true, paperSpeedMmPerS: 25, gainMmPerMv: 10, strictTraceMaxThicknessPx: 100,
    provenance: { locator: "case://review-strict-provenance", projectGold: false },
  };
  const intake = runImageIntakePipeline(input);
  const caseReceipt = persistImageIntakeCase(root, input, intake);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, intake);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const config = {
    measurement: {
      detector: { minAbsoluteDeviation: 0.25, refractoryMs: 240 },
      delineation: {
        baseline: 0,
        qrs: { threshold: 0.35, beforeMs: 80, afterMs: 80 },
        p: { threshold: 0.15, searchStartMsBeforeR: 240, searchEndMsBeforeR: 80 },
        t: { threshold: 0.2, searchStartMsAfterR: 100, searchEndMsAfterR: 400 },
      },
    },
    phenotypes: {
      minBeatCount: 2,
      rrIrregularity: { minIntervals: 2, cvAtOrAbove: 0.1, maxSuccessiveDeltaMsAtOrAbove: 100 },
      pause: { minIntervals: 1, absoluteRrMsAtOrAbove: 1400, medianMultipleAtOrAbove: 1.5 },
      qrsDuration: { medianMsAtOrAbove: 120 }, pWaveCoverage: { ratioAtOrBelow: 0.5 }, prDuration: { medianMsAtOrAbove: 200 },
    },
    thresholdAuthority: "SYNTHETIC_ADVERSARIAL_REVIEW_ONLY",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2, maxAmplitudeUncertaintyMv: 1, maxTimePixelUncertaintyMs: 4 },
  };
  const analysis = runImageSignalAnalysis(extraction, config);
  const receipt = persistImageAnalysis(caseReceipt.path, analysis);
  const caseDir = path.dirname(caseReceipt.path);

  function publishUntrusted(base) {
    const analysisId = `analysis-${hash(Buffer.from(json(base)))}`;
    const dir = path.join(caseDir, "analyses", analysisId);
    fs.mkdirSync(dir, { recursive: true });
    const body = Buffer.from(json({ ...base, analysisId }));
    fs.writeFileSync(path.join(dir, "analysis.json"), body);
    fs.writeFileSync(path.join(dir, "analysis.sha256"), `${hash(body)}\n`);
    return analysisId;
  }

  test("each valid but false implementation hash fails publication and integrity-rehashed reopening", () => {
    for (let index = 0; index < analysis.implementations.length; index += 1) {
      const changed = clone(analysis);
      changed.implementations[index].sha256 = hash(`wrong implementation ${index}`);
      assert.throws(() => persistImageAnalysis(caseDir, changed), /IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH/);
      assert.throws(() => readImageAnalysis(caseDir, publishUntrusted(changed)), /IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH/);
    }
  });

  test("implementation names, membership and order fail independently of hash syntax", () => {
    for (const mutate of [
      a => { a.implementations.pop(); },
      a => { a.implementations[0] = a.implementations[1]; },
      a => { a.implementations.reverse(); },
      a => { a.implementations[0].file = "../lib/image_digitization.js"; },
      a => { a.implementations[0].sha256 = a.implementations[0].sha256.toUpperCase(); },
    ]) {
      const changed = clone(analysis);
      mutate(changed);
      assert.throws(() => persistImageAnalysis(caseDir, changed), /IMAGE_ANALYSIS_IMPLEMENTATION_IDENTITY/);
    }
  });

  test("execution identity includes independently hashed transitive JS and JSON artifacts", () => {
    const execution = analysis.executionIdentity;
    assert.strictEqual(execution.schema, "ekg-image-analysis-execution-v1");
    assert.strictEqual(execution.entryPoint, "lib/image_signal_analysis.js");
    assert.ok(execution.artifacts.some(row => row.file === "lib/multilead_signal_intelligence.js"));
    assert.ok(execution.artifacts.some(row => row.file === "evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json"));
    assert.strictEqual(new Set(execution.artifacts.map(row => row.file)).size, execution.artifacts.length);
    for (const row of execution.artifacts) {
      const body = fs.readFileSync(path.join(repo, row.file));
      assert.strictEqual(row.bytes, body.length);
      assert.strictEqual(row.sha256, hash(body));
    }
    assert.deepStrictEqual(readImageAnalysis(caseDir, receipt.analysisId).executionIdentity, execution);
    assert.strictEqual(persistImageAnalysis(caseDir, clone(analysis)).idempotent, true);
  });

  test("matching eight hashes cannot substitute missing, old or incomplete execution identity", () => {
    for (const mutate of [
      a => { delete a.executionIdentity; },
      a => { a.executionIdentity.schema = "ekg-image-analysis-execution-v0"; },
      a => { a.executionIdentity.entryPoint = "lib/signal_measurement_pipeline.js"; },
      a => { a.executionIdentity.artifacts.pop(); },
      a => { a.executionIdentity.artifacts[0].bytes += 1; },
      a => { a.executionIdentity.artifacts[0].sha256 = hash("another loaded artifact"); },
      a => { a.executionIdentity.artifacts.reverse(); },
    ]) {
      const changed = clone(analysis);
      mutate(changed);
      assert.throws(() => persistImageAnalysis(caseDir, changed), /IMAGE_ANALYSIS_EXECUTION_IDENTITY_(REQUIRED|MISMATCH)/);
      assert.throws(() => readImageAnalysis(caseDir, publishUntrusted(changed)), /IMAGE_ANALYSIS_EXECUTION_IDENTITY_(REQUIRED|MISMATCH)/);
    }
  });

  test("baseline legacy bytes remain auditable without rewriting hashes or replaying old measurements", () => {
    const bytes = fs.readFileSync(path.join(repo, "tests/strict_analysis_legacy_f3e38bb.json"));
    assert.strictEqual(bytes.length, 340717);
    assert.strictEqual(hash(bytes), "a83378662acf3761770a10c370a97034b7118224be158eca2668e16c8a1ea949");
    const artifact = JSON.parse(bytes);
    assert.strictEqual(artifact.extractionId, extraction.extractionId);
    assert.strictEqual(artifact.caseId, extraction.caseId);
    const { analysisId, ...base } = artifact;
    assert.strictEqual(publishUntrusted(base), analysisId);
    const file = path.join(caseDir, "analyses", analysisId, "analysis.json");
    assert.ok(fs.readFileSync(file).equals(bytes));
    const before = fs.statSync(file);
    const audit = auditImageAnalysis(caseDir, analysisId);
    assert.deepStrictEqual(audit.artifact, artifact);
    assert.strictEqual(audit.storedBytesAndSourceIdentityVerified, true);
    assert.strictEqual(audit.implementationProvenance, "NOT_VERIFIED");
    assert.strictEqual(audit.semanticValidation, "NOT_PERFORMED");
    assert.strictEqual(audit.replayPerformed, false);
    assert.strictEqual(audit.readOnly, true);
    assert.strictEqual(audit.runtimeAuthority, false);
    assert.strictEqual(fs.statSync(file).mtimeMs, before.mtimeMs);
    assert.ok(fs.readFileSync(file).equals(bytes));
    assert.throws(() => readImageAnalysis(caseDir, analysisId), /IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH/);
    assert.throws(() => persistImageAnalysis(caseDir, base), /IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH/);
    fs.appendFileSync(file, " ");
    assert.throws(() => auditImageAnalysis(caseDir, analysisId), /IMAGE_ANALYSIS_HASH_MISMATCH/);
    fs.writeFileSync(file, bytes);
    const extractionBytes = fs.readFileSync(extractionReceipt.path);
    fs.appendFileSync(extractionReceipt.path, " ");
    assert.throws(() => auditImageAnalysis(caseDir, analysisId), /EXTRACTION_HASH_MISMATCH/);
    fs.writeFileSync(extractionReceipt.path, extractionBytes);
  });

  const sandbox = path.join(root, "implementation");
  fs.mkdirSync(sandbox);
  fs.cpSync(path.join(repo, "lib"), path.join(sandbox, "lib"), { recursive: true });
  fs.mkdirSync(path.join(sandbox, "evaluation", "protocols"), { recursive: true });
  fs.copyFileSync(path.join(repo, "evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json"),
    path.join(sandbox, "evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json"));
  fs.writeFileSync(path.join(sandbox, "input.json"), json({ extraction, config, analysis, caseDir, analysisId: receipt.analysisId }));

  function child(code) {
    const result = spawnSync(process.execPath, ["-e", `
      const assert = require('assert');
      const fs = require('fs');
      const crypto = require('crypto');
      const input = require('./input.json');
      const file = './lib/signal_measurement_pipeline.js';
      const original = fs.readFileSync(file);
      try { ${code} } finally { if (fs.existsSync(file) && fs.lstatSync(file).isDirectory()) fs.rmdirSync(file); fs.writeFileSync(file, original); }
    `], { cwd: sandbox, encoding: "utf8", timeout: 60000 });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ifError(result.error);
  }

  test("fresh process reopens exact execution bytes without rerunning analysis", () => {
    child(`
      const store = require('./lib/image_analysis_store');
      const reopened = store.readImageAnalysis(input.caseDir, input.analysisId);
      assert.deepStrictEqual(reopened.executionIdentity, input.analysis.executionIdentity);
    `);
  });

  test("preloaded poisoned CommonJS exports cannot masquerade as the bytes used by strict execution", () => {
    child(`
      let calls = 0;
      require('./lib/signal_measurement_pipeline').runPhysicalLeadMeasurementPipeline = () => { calls++; throw new Error('WRONG_LOADED_IMPLEMENTATION'); };
      const engine = require('./lib/image_signal_analysis');
      const result = engine.runImageSignalAnalysis(input.extraction, input.config);
      assert.strictEqual(calls, 0);
      assert.deepStrictEqual(result, input.analysis);
    `);
  });

  test("loaded code then changed disk fails analysis, publication and reopening even with refreshed declarations", () => {
    child(`
      const engine = require('./lib/image_signal_analysis');
      const store = require('./lib/image_analysis_store');
      fs.appendFileSync(file, '\\n');
      const row = input.analysis.implementations.find(r => r.file === 'lib/signal_measurement_pipeline.js');
      row.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      assert.throws(() => engine.runImageSignalAnalysis(input.extraction, input.config), /IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH/);
      assert.throws(() => store.persistImageAnalysis(input.caseDir, input.analysis), /IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH/);
      assert.throws(() => store.readImageAnalysis(input.caseDir, input.analysisId), /IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH/);
      assert.strictEqual(store.auditImageAnalysis(input.caseDir, input.analysisId).implementationProvenance, 'NOT_VERIFIED');
    `);
  });

  test("changed bytes compiled then restored on disk cannot inherit the restored source identity", () => {
    child(`
      fs.appendFileSync(file, '\\n');
      const engine = require('./lib/image_signal_analysis');
      fs.writeFileSync(file, original);
      assert.throws(() => engine.runImageSignalAnalysis(input.extraction, input.config), /IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH/);
    `);
  });

  test("different installed version yields a distinct identity and leaves prior records audit-only", () => {
    child(`
      fs.appendFileSync(file, '\\n');
      const engine = require('./lib/image_signal_analysis');
      const store = require('./lib/image_analysis_store');
      const changed = engine.runImageSignalAnalysis(input.extraction, input.config);
      assert.notDeepStrictEqual(changed.executionIdentity, input.analysis.executionIdentity);
      assert.deepStrictEqual(changed.leadAnalyses, input.analysis.leadAnalyses);
      assert.throws(() => store.readImageAnalysis(input.caseDir, input.analysisId), /IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH/);
      assert.strictEqual(store.auditImageAnalysis(input.caseDir, input.analysisId).replayPerformed, false);
    `);
  });

  test("artifact substitution during the loader read is detected and descriptors are closed", () => {
    child(`
      const originalFs = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync };
      let target;
      let injected = false;
      const opened = new Set();
      try {
        fs.openSync = (name, ...args) => {
          const fd = originalFs.openSync(name, ...args);
          opened.add(fd);
          if (String(name).endsWith('signal_measurement_pipeline.js')) target = fd;
          return fd;
        };
        fs.closeSync = fd => { opened.delete(fd); return originalFs.closeSync(fd); };
        fs.readSync = (fd, ...args) => {
          const count = originalFs.readSync(fd, ...args);
          if (fd === target && !injected) { injected = true; fs.appendFileSync(file, '\\n'); }
          return count;
        };
        assert.throws(() => require('./lib/image_signal_analysis'), /IMAGE_STORE_FILE_CHANGED/);
        assert.strictEqual(injected, true);
        assert.strictEqual(opened.size, 0);
      } finally { Object.assign(fs, originalFs); }
    `);
  });

  for (const dependency of ['lib/multilead_signal_intelligence.js', 'evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json']) {
    test(`transitive artifact drift and absence fail closed: ${dependency}`, () => {
      child(`
        const dependency = ${JSON.stringify(dependency)};
        const bytes = fs.readFileSync(dependency);
        const engine = require('./lib/image_signal_analysis');
        try {
          fs.appendFileSync(dependency, '\\n');
          assert.throws(() => engine.runImageSignalAnalysis(input.extraction, input.config), /IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH/);
          fs.unlinkSync(dependency);
          assert.throws(() => engine.runImageSignalAnalysis(input.extraction, input.config), /IMAGE_ANALYSIS_IMPLEMENTATION_FILE_REQUIRED/);
        } finally { fs.writeFileSync(dependency, bytes); }
      `);
    });
  }

  test("audit does not load an analysis implementation or compile a replay", () => {
    child(`
      const compile = require('vm').compileFunction;
      require('vm').compileFunction = () => { throw new Error('UNEXPECTED_ANALYSIS_COMPILATION'); };
      fs.unlinkSync(file);
      try {
        const audit = require('./lib/image_analysis_store').auditImageAnalysis(input.caseDir, input.analysisId);
        assert.strictEqual(audit.replayPerformed, false);
        assert.strictEqual(audit.implementationProvenance, 'NOT_VERIFIED');
      } finally { require('vm').compileFunction = compile; }
    `);
  });

  test("strict persistence retains synchronization failure propagation and staging cleanup", () => {
    const changed = clone(analysis);
    changed.thresholdAuthority = 'SYNTHETIC_STRICT_DURABILITY_ONLY';
    changed.configuration.thresholdAuthority = changed.thresholdAuthority;
    const original = fs.fsyncSync;
    const failure = new Error('INJECTED_STRICT_FSYNC');
    let called = false;
    try {
      fs.fsyncSync = () => { called = true; throw failure; };
      assert.throws(() => persistImageAnalysis(caseDir, changed), error => error === failure);
      assert.strictEqual(called, true);
    } finally { fs.fsyncSync = original; }
    assert.ok(fs.readdirSync(path.join(caseDir, 'analyses')).every(name => !name.startsWith('.staging-')));
    assert.strictEqual(persistImageAnalysis(caseDir, changed).idempotent, false);
  });

  for (const afterLoad of [false, true]) {
    for (const missing of ["missing", "directory", "empty", "oversized", "invalid-utf8"]) {
      test(`${missing} implementation ${afterLoad ? "after" : "before"} load fails closed`, () => {
        child(`
          const engine = ${afterLoad ? "require('./lib/image_signal_analysis')" : "null"};
          ${missing === "missing" ? "fs.unlinkSync(file);" : missing === "directory" ? "fs.unlinkSync(file); fs.mkdirSync(file);" :
            missing === "empty" ? "fs.writeFileSync(file, '');" : missing === "oversized" ? "fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));" : "fs.writeFileSync(file, Buffer.from([255, 254, 253]));"}
          assert.throws(() => engine ? engine.runImageSignalAnalysis(input.extraction, input.config) : require('./lib/image_signal_analysis'),
            /IMAGE_ANALYSIS_IMPLEMENTATION_(FILE_REQUIRED|ENCODING)|IMAGE_STORE_BYTES_LIMIT|IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH/);
          const audit = require('./lib/image_analysis_store').auditImageAnalysis(input.caseDir, input.analysisId);
          assert.strictEqual(audit.implementationProvenance, 'NOT_VERIFIED');
        `);
      });
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ schema: "ekg-image-analysis-provenance-tests-v1", passed, syntheticOnly: true, clinicalAuthorityAdded: false }));
