"use strict";

// EKG-G1 (hardening): concurrent admission near capacity must never publish
// more than MAX_CORRECTIONS durable correction directories.
//
// Eight real OS processes race to publish eight DISTINCT corrections when only
// one slot remains (127 of 128 filled). Cross-process admission is serialized
// by the mkdir-based admission lock, so exactly one racer must succeed and the
// other seven must be refused with CLINICIAN_CORRECTION_LIMIT before publish.
// A ninth process concurrently replays an already-persisted correction, which
// must succeed idempotently without taking the lock.
//
// Deterministic expectations (order of racers is nondeterministic, counts are
// not): durable correction directories == 128 afterwards, the reader reopens
// the full store, and the analysis bytes are unchanged.

const assert = require("assert");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");
const execFileAsync = util.promisify(execFile);
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { persistImageAnalysis } = require("../lib/image_analysis_store");
const { persistClinicianCorrection, MAX_CORRECTIONS } = require("../lib/clinician_correction_store");
const { buildClinicianReaderModel } = require("../lib/clinician_reader_model");

const LIB_DIR = path.join(__dirname, "..", "lib");
const RACER_COUNT = 8;

function fixture() {
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
    provenance: { locator: "case://clinician-correction-concurrency", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-correction-concurrency-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const analysis = runImageSignalAnalysis(extraction, {
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
    thresholdAuthority: "SYNTHETIC_TEST_CONFIGURATION_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  });
  const analysisReceipt = persistImageAnalysis(caseReceipt.path, analysis);
  return { root, caseReceipt, analysisReceipt };
}

function caseDirOf(fx) {
  return path.dirname(fx.caseReceipt.path);
}

function correctionsDir(fx) {
  return path.join(caseDirOf(fx), "analyses", fx.analysisReceipt.analysisId, "corrections");
}

function statementFor(i) {
  return `Concurrency probe note ${i}. No diagnostic claim is made.`;
}

// Runs in a child process: persists one correction (or replays correction 0)
// and reports the outcome as JSON on stdout.
// exit 0: persisted (or replayed); exit 2: refused with CLINICIAN_CORRECTION_LIMIT;
// exit 1: unexpected failure.
const WORKER_SCRIPT = `
const path = require("path");
const [casePath, analysisId, mode, index, libDir] = process.argv.slice(1);
const { persistClinicianCorrection } = require(path.join(libDir, "clinician_correction_store"));
const statement = mode === "replay"
  ? "Concurrency probe note 0. No diagnostic claim is made."
  : \`Concurrency probe note \${index}. No diagnostic claim is made.\`;
try {
  const receipt = persistClinicianCorrection(casePath, {
    analysisId,
    reviewerId: "synthetic-reviewer-1",
    statement,
  });
  console.log(JSON.stringify({ ok: true, correctionId: receipt.correctionId, mode }));
} catch (error) {
  if (error && error.message === "CLINICIAN_CORRECTION_LIMIT") {
    console.log(JSON.stringify({ ok: false, code: "CLINICIAN_CORRECTION_LIMIT", mode }));
    process.exit(2);
  }
  console.error((error && error.stack) || String(error));
  process.exit(1);
}
`;

async function runWorker(fx, mode, index) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["-e", WORKER_SCRIPT, fx.caseReceipt.path, fx.analysisReceipt.analysisId, mode, String(index), LIB_DIR],
      { timeout: 60000 }
    );
    return { exit: 0, result: JSON.parse(stdout.trim()) };
  } catch (error) {
    const stdout = (error.stdout || "").trim();
    return { exit: error.code, result: stdout ? JSON.parse(stdout) : null, stderr: error.stderr };
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Deterministic falsification of the lock-acquisition race: a lock directory
// that exists with no token yet and a fresh mtime is a LIVE holder in the
// mkdir -> token-write window (microseconds in practice). A contender must
// wait for it, never delete it. The pre-hardening code treated an unreadable
// token as stale and stole the directory immediately; this test fails on that
// behavior and passes on the hardened protocol.
async function stealPreventionTest() {
  const fx = fixture();
  try {
    const lockDir = path.join(caseDirOf(fx), "analyses", fx.analysisReceipt.analysisId, ".correction-admission.lock");
    fs.mkdirSync(lockDir); // Simulate a holder between mkdir and its token write.
    const analysisFile = fx.analysisReceipt.path;
    const analysisBefore = fs.readFileSync(analysisFile);
    const pending = runWorker(fx, "new", 0);
    await sleepMs(800);
    const stillThere = fs.existsSync(lockDir);
    fs.rmSync(lockDir, { recursive: true, force: true }); // Holder "finishes"; free the name.
    const outcome = await pending;
    assert.ok(stillThere, "contender stole a fresh lock directory whose token was not yet written");
    assert.strictEqual(outcome.exit, 0, `worker must publish after the holder releases, got ${JSON.stringify(outcome)}`);
    assert.strictEqual(fs.readdirSync(correctionsDir(fx)).length, 1);
    const reader = buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(reader.corrections.items.length, 1);
    assert.deepStrictEqual(fs.readFileSync(analysisFile), analysisBefore);
    console.log("PASS contender waits for a fresh token-less lock directory instead of stealing it");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

async function main() {
  assert.strictEqual(MAX_CORRECTIONS, 128);
  await stealPreventionTest();
  const fx = fixture();
  try {
    for (let i = 0; i < MAX_CORRECTIONS - 1; i += 1) {
      persistClinicianCorrection(fx.caseReceipt.path, {
        analysisId: fx.analysisReceipt.analysisId,
        reviewerId: "synthetic-reviewer-1",
        statement: statementFor(i),
      });
    }
    assert.strictEqual(fs.readdirSync(correctionsDir(fx)).length, MAX_CORRECTIONS - 1);
    const analysisFile = fx.analysisReceipt.path;
    const analysisBefore = fs.readFileSync(analysisFile);

    const racers = [];
    for (let i = 0; i < RACER_COUNT; i += 1) {
      racers.push(runWorker(fx, "new", MAX_CORRECTIONS - 1 + i));
    }
    racers.push(runWorker(fx, "replay", 0));
    const outcomes = await Promise.all(racers);

    const unexpected = outcomes.filter((o) => o.exit !== 0 && o.exit !== 2);
    assert.strictEqual(
      unexpected.length, 0,
      `no worker may fail unexpectedly: ${JSON.stringify(unexpected.map((o) => o.stderr), null, 2)}`
    );
    const freshWins = outcomes.filter((o) => o.exit === 0 && o.result.mode === "new");
    const refusals = outcomes.filter((o) => o.exit === 2);
    const replayWins = outcomes.filter((o) => o.exit === 0 && o.result.mode === "replay");
    assert.strictEqual(freshWins.length, 1, `exactly one racer must win the last slot, got ${freshWins.length}`);
    assert.strictEqual(refusals.length, RACER_COUNT - 1, `expected ${RACER_COUNT - 1} refusals, got ${refusals.length}`);
    assert.ok(refusals.every((o) => o.result.code === "CLINICIAN_CORRECTION_LIMIT"), "all refusals must carry CLINICIAN_CORRECTION_LIMIT");
    assert.strictEqual(replayWins.length, 1, "concurrent idempotent replay must succeed");

    // Durable state after the race: exactly 128 correction directories, reader
    // reopens, analysis bytes unchanged.
    assert.strictEqual(fs.readdirSync(correctionsDir(fx)).length, MAX_CORRECTIONS);
    const reader = buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(reader.corrections.items.length, MAX_CORRECTIONS);
    assert.deepStrictEqual(fs.readFileSync(analysisFile), analysisBefore);
    console.log("PASS concurrent near-capacity admission serializes to exactly 128 corrections");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

main().then(
  () => console.log("concurrency tests passed"),
  (error) => { console.error(`FAIL: ${error.stack || error}`); process.exitCode = 1; }
);
