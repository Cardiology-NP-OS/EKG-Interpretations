"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { readImageAnalysis } = require("./image_analysis_store");
const { compareSixAxisScores, readSixAxisScore } = require("./six_axis_score_store");

const SESSION_ID_RE = /^session-[a-f0-9]{64}$/;
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

function sessionIdentity(record) {
  return `session-${sha256(Buffer.from(canonicalJson(record), "utf8"))}`;
}

function openClinicianReviewSession(fileOrDir, analysisId) {
  const caseDir = caseDirectory(fileOrDir);
  const analysis = readImageAnalysis(caseDir, analysisId);
  const analysisBytes = fs.readFileSync(path.join(caseDir, "analyses", analysis.analysisId, "analysis.json"));
  return {
    schema: "ekg-clinician-review-session-open-v1",
    caseDir,
    analysisId: analysis.analysisId,
    caseId: analysis.caseId,
    analysisSha256: sha256(analysisBytes),
    scoreIds: [],
    clinicalReleaseAuthorized: false,
    clinicalValidityInferred: false,
  };
}

function addSessionScore(session, scoreId) {
  requireCondition(session && session.schema === "ekg-clinician-review-session-open-v1", "SESSION_OPEN");
  requireCondition(session.clinicalReleaseAuthorized === false, "SESSION_AUTHORITY");
  const score = readSixAxisScore(session.caseDir, session.analysisId, scoreId);
  requireCondition(score.analysisId === session.analysisId && score.analysisSha256 === session.analysisSha256, "SESSION_SCORE_BINDING");
  const existing = session.scoreIds.map(id => readSixAxisScore(session.caseDir, session.analysisId, id));
  requireCondition(existing.every(row => row.reviewerId !== score.reviewerId), "SESSION_DUPLICATE_REVIEWER");
  requireCondition(session.scoreIds.length < 2, "SESSION_REVIEWER_LIMIT");
  return { ...session, scoreIds: [...session.scoreIds, scoreId] };
}

function readClinicianReviewSession(fileOrDir, analysisId, sessionId) {
  requireCondition(SESSION_ID_RE.test(sessionId), "SESSION_ID");
  const caseDir = caseDirectory(fileOrDir);
  const dir = path.join(caseDir, "analyses", analysisId, "sessions", sessionId);
  const body = readStoreFile(path.join(dir, "session.json"), MAX_BYTES, "SESSION_FILE_REQUIRED");
  const expectedHash = readStoreFile(path.join(dir, "session.sha256"), 65, "SESSION_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(/^[a-f0-9]{64}$/.test(expectedHash) && sha256(body) === expectedHash, "SESSION_HASH_MISMATCH");
  const artifact = parseStoreJson(body, "SESSION_JSON");
  requireCondition(artifact.sessionId === sessionId && artifact.clinicalReleaseAuthorized === false, "SESSION_AUTHORITY");
  const { sessionId: _id, ...base } = artifact;
  requireCondition(sessionIdentity(base) === sessionId, "SESSION_IDENTITY");
  return artifact;
}

function closeClinicianReviewSession(session) {
  requireCondition(session && session.schema === "ekg-clinician-review-session-open-v1", "SESSION_OPEN");
  requireCondition(session.clinicalReleaseAuthorized === false && session.scoreIds.length === 2, "SESSION_REVIEWERS");
  const scores = session.scoreIds.map(id => readSixAxisScore(session.caseDir, session.analysisId, id));
  const comparison = compareSixAxisScores(scores[0], scores[1]);
  const record = {
    schema: "ekg-clinician-review-session-v1",
    analysisId: session.analysisId,
    caseId: session.caseId,
    analysisSha256: session.analysisSha256,
    scoreIds: session.scoreIds.slice().sort(),
    reviewers: comparison.reviewers,
    disagreements: comparison.disagreements,
    criticalError: comparison.criticalError,
    result: comparison.result,
    averaged: false,
    criticalErrorAveragedAway: false,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    runtimeAuthority: false,
  };
  const sessionId = sessionIdentity(record);
  const body = canonicalJson({ ...record, sessionId });
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_BYTES, "SESSION_BYTES");
  const parent = path.join(session.caseDir, "analyses", session.analysisId, "sessions");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = path.join(parent, sessionId);
  if (!fs.existsSync(finalDir)) {
    const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
    try {
      fs.writeFileSync(path.join(stage, "session.json"), body, { encoding: "utf8", flag: "wx" });
      fs.writeFileSync(path.join(stage, "session.sha256"), `${sha256(Buffer.from(body, "utf8"))}\n`, { encoding: "ascii", flag: "wx" });
      fs.renameSync(stage, finalDir);
    } catch (error) {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  const saved = readClinicianReviewSession(session.caseDir, session.analysisId, sessionId);
  requireCondition(canonicalJson(saved) === body, "SESSION_REOPEN_MISMATCH");
  const analysisFile = path.join(session.caseDir, "analyses", session.analysisId, "analysis.json");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === session.analysisSha256, "SESSION_ANALYSIS_MUTATED");
  return {
    schema: "ekg-clinician-review-session-receipt-v1",
    analysisId: session.analysisId,
    sessionId,
    path: path.join(finalDir, "session.json"),
    result: saved.result,
    criticalError: saved.criticalError,
    averaged: false,
    clinicalReleaseAuthorized: false,
  };
}

module.exports = {
  addSessionScore,
  closeClinicianReviewSession,
  openClinicianReviewSession,
  readClinicianReviewSession,
};
