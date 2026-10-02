"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { createCaseRootStage, removeCaseRootStage } = require("./case_root_stage");
const { readImageAnalysis } = require("./image_analysis_store");

const SCORE_ID_RE = /^score-[a-f0-9]{64}$/;
const REVIEWER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const AXES = ["accuracy", "completeness", "findingsSurfaced", "significantOmissions", "decisionImpact", "claimTraceability"];
const MAX_NOTE = 1000;
const MAX_BYTES = 64 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function caseDirectory(fileOrDir) {
  const resolved = path.resolve(fileOrDir);
  const dir = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  readImageCase(dir);
  return dir;
}

function scoreIdentity(record) {
  return `score-${sha256(Buffer.from(canonicalJson(record), "utf8"))}`;
}

function readSixAxisScore(fileOrDir, analysisId, scoreId) {
  requireCondition(SCORE_ID_RE.test(scoreId), "SIX_AXIS_ID");
  const caseDir = caseDirectory(fileOrDir);
  const dir = path.join(caseDir, "analyses", analysisId, "scores", scoreId);
  const body = readStoreFile(path.join(dir, "score.json"), MAX_BYTES, "SIX_AXIS_FILE_REQUIRED");
  const expectedHash = readStoreFile(path.join(dir, "score.sha256"), 65, "SIX_AXIS_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(/^[a-f0-9]{64}$/.test(expectedHash) && sha256(body) === expectedHash, "SIX_AXIS_HASH_MISMATCH");
  const artifact = parseStoreJson(body, "SIX_AXIS_JSON");
  requireCondition(artifact.scoreId === scoreId, "SIX_AXIS_ID");
  const { scoreId: _id, ...base } = artifact;
  requireCondition(scoreIdentity(base) === scoreId, "SIX_AXIS_IDENTITY");
  requireCondition(artifact.clinicalReleaseAuthorized === false && artifact.clinicalValidityInferred === false, "SIX_AXIS_AUTHORITY");
  return artifact;
}

function persistSixAxisScore(fileOrDir, input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "SIX_AXIS_OBJECT_REQUIRED");
  requireCondition(["analysisId", "reviewerId", "axes", "criticalError"].every(key => Object.hasOwn(input, key)), "SIX_AXIS_FIELDS");
  requireCondition(Object.keys(input).every(key => ["analysisId", "reviewerId", "axes", "criticalError", "note"].includes(key)), "SIX_AXIS_FIELDS");
  requireCondition(REVIEWER_RE.test(input.reviewerId), "SIX_AXIS_REVIEWER");
  requireCondition(input.criticalError === true || input.criticalError === false, "SIX_AXIS_CRITICAL");
  requireCondition(input.axes && typeof input.axes === "object" && !Array.isArray(input.axes), "SIX_AXIS_AXES");
  requireCondition(Object.keys(input.axes).length === AXES.length && AXES.every(axis => Object.hasOwn(input.axes, axis)), "SIX_AXIS_AXES");
  const axes = {};
  for (const axis of AXES) {
    const value = input.axes[axis];
    requireCondition(Number.isInteger(value) && value >= 0 && value <= 4, "SIX_AXIS_RANGE");
    axes[axis] = value;
  }
  const note = Object.hasOwn(input, "note") ? input.note : "";
  requireCondition(typeof note === "string" && note.length <= MAX_NOTE, "SIX_AXIS_NOTE");
  requireCondition(!/clinically validated|diagnostic authority|clinical release/i.test(note), "SIX_AXIS_AUTHORITY_CLAIM");
  const caseDir = caseDirectory(fileOrDir);
  const analysis = readImageAnalysis(caseDir, input.analysisId);
  const analysisFile = path.join(caseDir, "analyses", analysis.analysisId, "analysis.json");
  const analysisBytes = fs.readFileSync(analysisFile);
  const record = {
    schema: "ekg-six-axis-score-v1",
    analysisId: analysis.analysisId,
    caseId: analysis.caseId,
    analysisSha256: sha256(analysisBytes),
    reviewerId: input.reviewerId,
    axes,
    criticalError: input.criticalError,
    note,
    origin: "CLINICIAN_REVIEWED",
    scoreIsNotValidation: true,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    runtimeAuthority: false,
  };
  const scoreId = scoreIdentity(record);
  const body = canonicalJson({ ...record, scoreId });
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_BYTES, "SIX_AXIS_BYTES");
  const parent = path.join(caseDir, "analyses", analysis.analysisId, "scores");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = path.join(parent, scoreId);
  if (!fs.existsSync(finalDir)) {
    const existing = fs.readdirSync(parent).filter(name => name.startsWith("score-"));
    for (const name of existing) {
      const prior = readSixAxisScore(caseDir, analysis.analysisId, name);
      requireCondition(prior.reviewerId !== input.reviewerId, "SIX_AXIS_DUPLICATE_REVIEWER");
    }
    const stage = createCaseRootStage(caseDir, "six-axis");
    try {
      fs.writeFileSync(path.join(stage, "score.json"), body, { encoding: "utf8", flag: "wx" });
      fs.writeFileSync(path.join(stage, "score.sha256"), `${sha256(Buffer.from(body, "utf8"))}\n`, { encoding: "ascii", flag: "wx" });
      fs.renameSync(stage, finalDir);
    } catch (error) {
      removeCaseRootStage(stage, caseDir, "six-axis");
      throw error;
    }
  }
  const saved = readSixAxisScore(caseDir, analysis.analysisId, scoreId);
  requireCondition(canonicalJson(saved) === body, "SIX_AXIS_REOPEN_MISMATCH");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === record.analysisSha256, "SIX_AXIS_ANALYSIS_MUTATED");
  return {
    schema: "ekg-six-axis-score-receipt-v1",
    analysisId: analysis.analysisId,
    scoreId,
    path: path.join(finalDir, "score.json"),
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    scoreIsNotValidation: true,
  };
}

function compareSixAxisScores(left, right) {
  requireCondition(left && right && left.schema === "ekg-six-axis-score-v1" && right.schema === "ekg-six-axis-score-v1", "SIX_AXIS_COMPARE");
  requireCondition(left.analysisId === right.analysisId, "SIX_AXIS_CASE");
  requireCondition(left.reviewerId !== right.reviewerId, "SIX_AXIS_SAME_REVIEWER");
  const disagreements = AXES.filter(axis => left.axes[axis] !== right.axes[axis]);
  const critical = left.criticalError === true || right.criticalError === true;
  return {
    schema: "ekg-six-axis-comparison-v1",
    analysisId: left.analysisId,
    reviewers: [left.reviewerId, right.reviewerId].sort(),
    disagreements,
    criticalError: critical,
    result: critical ? "FAIL_CRITICAL" : disagreements.length ? "DISAGREEMENT" : "AGREEMENT",
    averaged: false,
    criticalErrorAveragedAway: false,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
  };
}

module.exports = {
  AXES,
  compareSixAxisScores,
  persistSixAxisScore,
  readSixAxisScore,
};
