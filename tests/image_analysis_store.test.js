"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageCase, persistImageIntakeCase, readImageCase, readStoreFile } = require("../lib/image_case_store");
const { buildExtraction, persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { analysisIdentity, persistImageAnalysis, readImageAnalysis } = require("../lib/image_analysis_store");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function analysisConfig(authority = "SYNTHETIC_TEST_CONFIGURATION_ONLY_NOT_CLINICALLY_VALIDATED") {
  return {
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
      qrsDuration: { medianMsAtOrAbove: 120 },
      pWaveCoverage: { ratioAtOrBelow: 0.5 },
      prDuration: { medianMsAtOrAbove: 200 },
    },
    thresholdAuthority: authority,
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  };
}

function fixture(locator, strictTraceMaxThicknessPx) {
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
    roiLeadIdentityVerified: true,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator, projectGold: false },
    ...(strictTraceMaxThicknessPx === undefined ? {} : { strictTraceMaxThicknessPx }),
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-analysis-store-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const config = analysisConfig();
  if (strictTraceMaxThicknessPx !== undefined) {
    Object.assign(config.quality, { maxAmplitudeUncertaintyMv: 1, maxTimePixelUncertaintyMs: 4 });
  }
  const analysis = runImageSignalAnalysis(extraction, config);
  return { root, input, result, caseReceipt, extractionReceipt, extraction, analysis };
}

test("store reads reject substitution, growth and over-budget files and always close descriptors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-store-read-"));
  const file = path.join(root, "original.bin");
  const other = path.join(root, "other.bin");
  fs.writeFileSync(file, "original");
  fs.writeFileSync(other, "replaced");
  const original = { openSync: fs.openSync, closeSync: fs.closeSync, readSync: fs.readSync };
  let opened = 0;
  let closed = 0;
  try {
    fs.openSync = (...args) => { opened += 1; return original.openSync(...args); };
    fs.closeSync = fd => { closed += 1; return original.closeSync(fd); };
    assert.throws(() => readStoreFile(file, 7, "READ_FILE"), /IMAGE_STORE_BYTES_LIMIT/);
    assert.strictEqual(opened, 0);
    fs.openSync = (name, ...args) => { opened += 1; return original.openSync(name === file ? other : name, ...args); };
    assert.throws(() => readStoreFile(file, 8, "READ_FILE"), /IMAGE_STORE_FILE_CHANGED/);
    assert.strictEqual(closed, opened);
    fs.openSync = (...args) => { opened += 1; return original.openSync(...args); };
    let changed = false;
    fs.readSync = (...args) => {
      const count = original.readSync(...args);
      if (!changed) { changed = true; fs.appendFileSync(file, "growth"); }
      return count;
    };
    assert.throws(() => readStoreFile(file, 8, "READ_FILE"), /IMAGE_STORE_FILE_CHANGED/);
    assert.strictEqual(closed, opened);
  } finally {
    Object.assign(fs, original);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("all store readers reject ambiguous JSON even with a recomputed sidecar", () => {
  const crypto = require("crypto");
  const fx = fixture("case://canonical-store-json");
  const analysisReceipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const cases = [
    [fx.caseReceipt.path, () => readImageCase(fx.caseReceipt.path)],
    [fx.extractionReceipt.path, () => readImageExtraction(fx.caseReceipt.path, fx.extractionReceipt.extractionId)],
    [analysisReceipt.path, () => readImageAnalysis(fx.caseReceipt.path, analysisReceipt.analysisId)],
  ];
  try {
    for (const [file, reopen] of cases) {
      const body = fs.readFileSync(file, "utf8");
      const hashFile = file.replace(/\.json$/, ".sha256");
      const sidecar = fs.readFileSync(hashFile);
      try {
        for (const changed of [
          body.replace('"runtimeAuthority": false', '"runtimeAuthority": true, "runtimeAuthority": false'),
          body.replace('"runtimeAuthority": false', '"runtimeAuthority": false, "unbounded": 1e400'),
          body + " ",
        ]) {
          assert.notStrictEqual(changed, body);
          fs.writeFileSync(file, changed);
          fs.writeFileSync(hashFile, crypto.createHash("sha256").update(changed).digest("hex") + "\n");
          assert.throws(reopen, /(?:CASE_MANIFEST|EXTRACTION|IMAGE_ANALYSIS)_JSON/);
        }
      } finally {
        fs.writeFileSync(file, body);
        fs.writeFileSync(hashFile, sidecar);
      }
      assert.ok(reopen());
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("case reopening rejects directory indirection", () => {
  const fx = fixture("case://store-directory-indirection");
  const link = path.join(fx.root, "redirected");
  try {
    fs.symlinkSync(path.dirname(fx.caseReceipt.path), link, "junction");
    assert.throws(() => readImageCase(path.join(link, "manifest.json")), /IMAGE_STORE_DIRECTORY_REQUIRED/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

for (const kind of ["case", "extraction", "analysis"]) {
  test(`${kind} persistence uses writable sync descriptors and propagates durability failures`, () => {
    const fx = fixture(`case://durability-${kind}`);
    const files = kind === "case"
      ? ["original.bin", "normalized.png", "manifest.json", "manifest.sha256"]
      : [`${kind}.json`, `${kind}.sha256`];
    const directories = process.platform === "win32" ? [] : ["stage", "parent"];
    const scenarios = ["success", ...files, ...directories, "rename", "racing-sync", "racing-io",
      ...["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].map(code => `collision-${code}`)];
    if (process.platform !== "win32") scenarios.push("collision-parent");
    try {
      for (const [index, scenario] of scenarios.entries()) {
        const parent = kind === "case"
          ? path.join(fx.root, `cases-${index}`)
          : path.join(path.dirname(fx.caseReceipt.path), kind === "extraction" ? "extractions" : "analyses");
        fs.mkdirSync(parent, { recursive: true });
        const before = new Set(fs.readdirSync(parent));
        const result = JSON.parse(JSON.stringify(fx.result));
        result.digitized.leads[0].samples[0] += (index + 1) / 1000;
        const analysis = runImageSignalAnalysis(fx.extraction, analysisConfig(`SYNTHETIC_DURABILITY_${index}`));
        const finalName = kind === "case" ? `case-${fx.result.report.caseId}`
          : kind === "extraction" ? buildExtraction(readImageCase(fx.caseReceipt.path), result).extractionId
            : analysisIdentity(analysis);
        const persist = () => kind === "case"
          ? persistImageCase(parent, fx.result, {
            originalBytes: Buffer.from("synthetic durability fixture"),
            normalizedRaster: fx.input.raster,
          })
          : kind === "extraction"
            ? persistImageExtraction(fx.caseReceipt.path, result)
            : persistImageAnalysis(fx.caseReceipt.path, analysis);
        const reopen = dir => kind === "case" ? readImageCase(dir)
          : kind === "extraction" ? readImageExtraction(fx.caseReceipt.path, path.basename(dir))
            : readImageAnalysis(fx.caseReceipt.path, path.basename(dir));
        const original = { openSync: fs.openSync, closeSync: fs.closeSync, fsyncSync: fs.fsyncSync, renameSync: fs.renameSync };
        const descriptors = new Map();
        const events = [];
        const failure = Object.assign(new Error(`INJECTED_${kind}_${scenario}`), { code: "EIO" });
        let receipt;
        let injected = false;
        fs.openSync = (file, flags, ...args) => {
          const fd = original.openSync(file, flags, ...args);
          descriptors.set(fd, { file: path.resolve(file), flags });
          return fd;
        };
        fs.closeSync = fd => {
          descriptors.delete(fd);
          return original.closeSync(fd);
        };
        fs.fsyncSync = fd => {
          const { file, flags } = descriptors.get(fd);
          const directory = fs.fstatSync(fd).isDirectory();
          assert.strictEqual(flags, directory ? "r" : "r+", `${kind} ${scenario} descriptor`);
          const event = directory ? (file === parent ? "parent" : "stage") : path.basename(file);
          events.push(event);
          if (scenario === event || (scenario === "collision-parent" && event === "parent") ||
              (scenario === "racing-sync" && event === files[files.length - 1])) {
            if (scenario === "racing-sync") {
              fs.cpSync(path.dirname(file), path.join(parent, finalName), { recursive: true });
            }
            injected = true;
            throw failure;
          }
          return original.fsyncSync(fd);
        };
        fs.renameSync = (stage, finalDir) => {
          events.push("rename");
          if (scenario.startsWith("collision-") || scenario === "racing-io") {
            fs.cpSync(stage, finalDir, { recursive: true });
            if (scenario === "racing-io") {
              injected = true;
              throw failure;
            }
            throw Object.assign(new Error("INJECTED_CONCURRENT_PUBLICATION"), {
              code: scenario === "collision-parent" ? "EEXIST" : scenario.slice("collision-".length),
            });
          }
          if (scenario === "rename") {
            injected = true;
            throw failure;
          }
          return original.renameSync(stage, finalDir);
        };
        const succeeds = scenario === "success" || (scenario.startsWith("collision-") && scenario !== "collision-parent");
        try {
          if (succeeds) receipt = persist();
          else assert.throws(persist, error => error === failure, `${kind} ${scenario}`);
          assert.strictEqual(injected, !succeeds, `${kind} ${scenario} injection reached`);
          assert.strictEqual(descriptors.size, 0, `${kind} ${scenario} descriptors closed`);
        } finally {
          Object.assign(fs, original);
        }
        const added = fs.readdirSync(parent).filter(name => !before.has(name));
        assert.ok(added.every(name => !name.startsWith(".staging-")), `${kind} ${scenario} staging cleanup`);
        const published = succeeds || ["parent", "collision-parent", "racing-sync", "racing-io"].includes(scenario);
        assert.strictEqual(added.length, published ? 1 : 0, `${kind} ${scenario} publication`);
        if (succeeds || scenario === "parent" || scenario === "collision-parent" || scenario === "racing-io") {
          const artifact = reopen(path.join(parent, added[0]));
          assert.strictEqual(artifact.runtimeAuthority, false);
          assert.strictEqual(artifact.diagnosticRuntime, "GOVERNED_INACTIVE");
        }
        if (succeeds) {
          assert.deepStrictEqual(events, [...files, ...directories.filter(x => x === "stage"), "rename", ...directories.filter(x => x === "parent")]);
          const again = persist();
          assert.strictEqual(again.idempotent, true);
          assert.strictEqual(again.sha256, receipt.sha256);
        } else if (files.includes(scenario) || scenario === "stage" || scenario === "racing-sync") {
          assert.ok(!events.includes("rename"), `${kind} ${scenario} cannot publish before sync`);
        }
      }
    } finally {
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  });
}

test("analysis persists as an immutable content-addressed generation", () => {
  const fx = fixture("case://analysis-store-1");
  const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const reopened = readImageAnalysis(fx.caseReceipt.path, receipt.analysisId);
  assert.ok(/^analysis-[a-f0-9]{64}$/.test(receipt.analysisId));
  assert.strictEqual(reopened.analysisId, receipt.analysisId);
  assert.strictEqual(reopened.caseId, fx.analysis.caseId);
  assert.strictEqual(reopened.extractionId, fx.extraction.extractionId);
  assert.strictEqual(reopened.processedLeadCount, 12);
  assert.strictEqual(reopened.completeStandardTwelveLead, true);
  assert.strictEqual(reopened.diagnosticInterpretationIncluded, false);
  assert.strictEqual(reopened.runtimeAuthority, false);
});

test("identical analysis persistence is idempotent", () => {
  const fx = fixture("case://analysis-store-idempotent");
  const first = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const second = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(first.analysisId, second.analysisId);
  assert.strictEqual(first.sha256, second.sha256);
  const analyses = path.join(path.dirname(fx.caseReceipt.path), "analyses");
  assert.strictEqual(fs.readdirSync(analyses).filter(name => name.startsWith("analysis-")).length, 1);
  assert.strictEqual(fs.readdirSync(analyses).filter(name => name.startsWith(".staging-")).length, 0);
});

test("changed analysis configuration creates a new immutable generation", () => {
  const fx = fixture("case://analysis-store-generation");
  const first = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const changed = runImageSignalAnalysis(
    fx.extraction,
    analysisConfig("SYNTHETIC_ALTERNATE_CONFIGURATION_NOT_CLINICALLY_VALIDATED"),
  );
  const second = persistImageAnalysis(fx.caseReceipt.path, changed);
  assert.notStrictEqual(first.analysisId, second.analysisId);
  const analyses = path.join(path.dirname(fx.caseReceipt.path), "analyses");
  assert.strictEqual(fs.readdirSync(analyses).filter(name => name.startsWith("analysis-")).length, 2);
});

test("analysis reopen rejects analysis-byte tampering", () => {
  const fx = fixture("case://analysis-store-tamper");
  const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  fs.appendFileSync(receipt.path, " ");
  assert.throws(
    () => readImageAnalysis(fx.caseReceipt.path, receipt.analysisId),
    /IMAGE_ANALYSIS_HASH_MISMATCH/,
  );
});

test("analysis reopen revalidates the bound extraction", () => {
  const fx = fixture("case://analysis-store-extraction-tamper");
  const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const extractionFile = fx.extractionReceipt.path;
  fs.appendFileSync(extractionFile, " ");
  assert.throws(
    () => readImageAnalysis(fx.caseReceipt.path, receipt.analysisId),
    /EXTRACTION_HASH_MISMATCH/,
  );
});

test("persistence rejects injected diagnosis fields", () => {
  const fx = fixture("case://analysis-store-diagnosis");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.diagnosis = "UNSUPPORTED";
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_FORBIDDEN_FIELD/,
  );
});

test("persistence rejects nested authority escalation", () => {
  const fx = fixture("case://analysis-store-authority");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.leadAnalyses[0].features.runtimeAuthority = true;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_GOVERNANCE/,
  );
});

test("persistence rejects falsified cross-lead consistency", () => {
  const fx = fixture("case://analysis-store-cross-lead-tamper");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.crossLeadConsistency.beatCount.median += 1;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_CROSS_LEAD_CONSISTENCY/,
  );
});

test("persistence rejects falsified simultaneous paper groups", () => {
  const fx = fixture("case://analysis-store-simultaneous-tamper");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.simultaneousPaperGroups[0].leads = ["I", "III", "V6"];
  changed.simultaneousPaperGroups[0].leadCount = 3;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_SIMULTANEOUS_GROUPS/,
  );
});

test("persistence requires complete supplemental paper-window accounting", () => {
  const fx = fixture("case://analysis-store-supplemental-accounting");
  assert.strictEqual(fx.analysis.supplementalPaperWindowAnalyses.length, 1);
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.supplementalPaperWindowAnalyses = [];
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_SUPPLEMENTAL_ACCOUNTING/,
  );
});

test("persistence rejects supplemental panel-window substitution", () => {
  const fx = fixture("case://analysis-store-supplemental-window");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.supplementalPaperWindowAnalyses[0].paperWindow.startSeconds = 2.5;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_SUPPLEMENTAL_SOURCE/,
  );
});

test("persistence rejects lead paper-window substitution", () => {
  const fx = fixture("case://analysis-store-window-tamper");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  const row = changed.leadAnalyses.find(item => item.leadName === "V1");
  row.paperWindow.startSeconds = 7.5;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_PAPER_WINDOW_BINDING/,
  );
});

test("analysis cannot bind to a substituted extraction identity", () => {
  const fx = fixture("case://analysis-store-extraction-id");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.extractionId = `extract-${"0".repeat(64)}`;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /EXTRACTION_FILE_REQUIRED|IMAGE_ANALYSIS_EXTRACTION_MISMATCH/,
  );
});

test("saved strict analyses bind configuration, implementation identities and exact extraction quality", () => {
  const fx = fixture("case://strict-provenance-store", 100);
  try {
    const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
    const reopened = readImageAnalysis(fx.caseReceipt.path, receipt.analysisId);
    assert.deepStrictEqual(reopened.configuration, fx.analysis.configuration);
    assert.strictEqual(reopened.implementations.length, 8);
    const crypto = require("crypto");
    for (const row of reopened.implementations) {
      assert.strictEqual(row.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, "..", row.file))).digest("hex"));
    }
    for (const mutate of [
      out => { out.leadAnalyses[0].extractionQuality.maxAmplitudeUncertaintyMv = 0.001; },
      out => { out.supplementalPaperWindowAnalyses[0].extractionQuality.maxAmplitudeUncertaintyMv = 0.001; },
      out => { out.configuration.quality.maxTimePixelUncertaintyMs = 0.001; },
      out => { out.implementations[0].sha256 = "invalid"; },
      out => { out.qualityPolicy.maxAmplitudeUncertaintyMv = 0.001; out.configuration.quality.maxAmplitudeUncertaintyMv = 0.001; },
      out => { delete out.configuration; },
    ]) {
      const changed = JSON.parse(JSON.stringify(fx.analysis));
      mutate(changed);
      assert.throws(() => persistImageAnalysis(fx.caseReceipt.path, changed), /IMAGE_ANALYSIS_(QUALITY_BINDING|CONFIG_BINDING|IMPLEMENTATION_IDENTITY|CONFIG_DATA)/);
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("legacy saved analysis quality also cannot be substituted independently of its source", () => {
  const fx = fixture("case://legacy-quality-binding");
  try {
    fx.analysis.leadAnalyses[0].extractionQuality = { ...fx.analysis.leadAnalyses[0].extractionQuality, heldColumnCount: 999 };
    assert.throws(() => persistImageAnalysis(fx.caseReceipt.path, fx.analysis), /IMAGE_ANALYSIS_QUALITY_BINDING/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-analysis-store-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticInterpretationIncluded: false,
  clinicalAuthorityAdded: false,
}));
