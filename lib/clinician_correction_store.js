"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { readImageAnalysis } = require("./image_analysis_store");

const CORRECTION_ID_RE = /^correction-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const REVIEWER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_STATEMENT = 4000;
const MAX_CORRECTION_BYTES = 64 * 1024;
// Single source of truth for correction capacity. The clinician reader refuses
// stores above this bound, so admission must refuse a NEW correction before it
// is published once the bound is reached. Idempotent replay of an already
// persisted correction is always allowed, even at capacity.
const MAX_CORRECTIONS = 128;
const ADMISSION_LOCK_TTL_MS = 60000;
const ADMISSION_LOCK_ATTEMPTS = 200;
const ADMISSION_LOCK_BACKOFF_MS = 50;
const FORBIDDEN_KEYS = new Set([
  "diagnosis",
  "diagnoses",
  "diagnosticconclusion",
  "clinicaldiagnosis",
  "treatmentrecommendation",
  "managementrecommendation",
  "patient",
  "patientid",
  "patientref",
  "mrn",
  "phi",
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fsyncFile(file) {
  const fd = fs.openSync(file, "r+");
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function fsyncDirectory(dir) {
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function removeCorrectionStage(stage, caseDir) {
  if (!stage || !fs.existsSync(stage)) return;
  requireCondition(path.dirname(stage) === caseDir, "CLINICIAN_CORRECTION_STAGE_SCOPE");
  requireCondition(path.basename(stage).startsWith(".correction-staging-"), "CLINICIAN_CORRECTION_STAGE_SCOPE");
  fs.rmSync(stage, { recursive: true, force: true });
}

// The lock lives beside the corrections directory (not inside it) so the
// reader's strict corrections-directory inventory never observes it.
function admissionLockDir(caseDir, analysisId) {
  return path.join(caseDir, "analyses", analysisId, ".correction-admission.lock");
}

function readAdmissionLockToken(lockDir) {
  try {
    const raw = fs.readFileSync(path.join(lockDir, "lock.json"), "utf8");
    const record = JSON.parse(raw);
    if (record && typeof record === "object" && typeof record.token === "string"
      && typeof record.acquiredAt === "number" && Number.isFinite(record.acquiredAt)) {
      return record;
    }
  } catch (error) {
    // Unreadable lock file: treat as stale so a crashed holder cannot wedge admission.
  }
  return null;
}

function spinWaitMs(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) { /* intentional brief backoff; lock is held for milliseconds */ }
}

// Serializes the count-check + publish sequence across processes on the same
// filesystem. mkdir is atomic: exactly one contender creates the directory.
// A holder that crashes is reclaimed after ADMISSION_LOCK_TTL_MS via its
// timestamped token; the token also prevents us from removing a lock that a
// successor legitimately acquired after our own went stale.
function withCorrectionAdmissionLock(caseDir, analysisId, fn) {
  const lockDir = admissionLockDir(caseDir, analysisId);
  const token = `${process.pid}-${Date.now()}-${process.hrtime.bigint()}`;
  let acquired = false;
  for (let attempt = 0; attempt < ADMISSION_LOCK_ATTEMPTS; attempt += 1) {
    try {
      fs.mkdirSync(lockDir);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const record = readAdmissionLockToken(lockDir);
      const ageMs = record ? Date.now() - record.acquiredAt : Infinity;
      if (ageMs > ADMISSION_LOCK_TTL_MS) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      spinWaitMs(ADMISSION_LOCK_BACKOFF_MS);
    }
  }
  requireCondition(acquired, "CLINICIAN_CORRECTION_ADMISSION_LOCK");
  try {
    fs.writeFileSync(path.join(lockDir, "lock.json"), `${JSON.stringify({ token, acquiredAt: Date.now() })}\n`, { encoding: "utf8" });
    return fn();
  } finally {
    try {
      const record = readAdmissionLockToken(lockDir);
      if (record && record.token === token) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Lock already gone or replaced by a legitimate successor; leave it alone.
    }
  }
}

function assertPlain(value, depth = 0) {
  requireCondition(depth <= 8, "CLINICIAN_CORRECTION_STRUCTURE");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  requireCondition(value && typeof value === "object", "CLINICIAN_CORRECTION_NOT_PLAIN");
  requireCondition(!Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, "CLINICIAN_CORRECTION_NOT_PLAIN");
  for (const [key, child] of Object.entries(value)) {
    requireCondition(!FORBIDDEN_KEYS.has(key.replace(/[_\s-]/g, "").toLowerCase()), "CLINICIAN_CORRECTION_FORBIDDEN_FIELD");
    if (child && typeof child === "object") assertPlain(child, depth + 1);
  }
}

function caseDirectory(fileOrDir) {
  const resolved = path.resolve(fileOrDir);
  const dir = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  readImageCase(dir);
  return dir;
}

function correctionIdentity(record) {
  return `correction-${sha256(Buffer.from(canonicalJson(record), "utf8"))}`;
}

function correctionDirectory(caseDir, analysisId, correctionId) {
  return path.join(caseDir, "analyses", analysisId, "corrections", correctionId);
}

function readClinicianCorrection(fileOrDir, analysisId, correctionId) {
  requireCondition(CORRECTION_ID_RE.test(correctionId), "CLINICIAN_CORRECTION_ID");
  const caseDir = caseDirectory(fileOrDir);
  const dir = correctionDirectory(caseDir, analysisId, correctionId);
  const artifactFile = path.join(dir, "correction.json");
  const hashFile = path.join(dir, "correction.sha256");
  const body = readStoreFile(artifactFile, MAX_CORRECTION_BYTES, "CLINICIAN_CORRECTION_FILE_REQUIRED");
  const expectedHash = readStoreFile(hashFile, 65, "CLINICIAN_CORRECTION_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(HASH_RE.test(expectedHash) && sha256(body) === expectedHash, "CLINICIAN_CORRECTION_HASH_MISMATCH");
  const artifact = parseStoreJson(body, "CLINICIAN_CORRECTION_JSON");
  requireCondition(artifact.correctionId === correctionId, "CLINICIAN_CORRECTION_ID");
  const { correctionId: _id, ...base } = artifact;
  requireCondition(correctionIdentity(base) === correctionId, "CLINICIAN_CORRECTION_IDENTITY");
  return artifact;
}

function persistClinicianCorrection(fileOrDir, input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "CLINICIAN_CORRECTION_OBJECT_REQUIRED");
  assertPlain(input);
  const keys = Object.keys(input);
  requireCondition(keys.every(key => ["analysisId", "reviewerId", "statement", "supersedes"].includes(key)), "CLINICIAN_CORRECTION_FIELDS");
  requireCondition(["analysisId", "reviewerId", "statement"].every(key => Object.hasOwn(input, key)), "CLINICIAN_CORRECTION_FIELDS");
  requireCondition(typeof input.statement === "string" && input.statement.length >= 1 && input.statement.length <= MAX_STATEMENT, "CLINICIAN_CORRECTION_STATEMENT");
  requireCondition(!/clinically validated|diagnostic authority|clinical release/i.test(input.statement), "CLINICIAN_CORRECTION_AUTHORITY_CLAIM");
  requireCondition(REVIEWER_RE.test(input.reviewerId), "CLINICIAN_CORRECTION_REVIEWER");
  const caseDir = caseDirectory(fileOrDir);
  const analysis = readImageAnalysis(caseDir, input.analysisId);
  const analysisFile = path.join(caseDir, "analyses", analysis.analysisId, "analysis.json");
  const analysisBytes = fs.readFileSync(analysisFile);
  const analysisSha256 = sha256(analysisBytes);
  let supersedes = null;
  if (Object.hasOwn(input, "supersedes")) {
    requireCondition(input.supersedes === null || CORRECTION_ID_RE.test(input.supersedes), "CLINICIAN_CORRECTION_SUPERSEDES");
    if (input.supersedes) {
      const prior = readClinicianCorrection(caseDir, analysis.analysisId, input.supersedes);
      requireCondition(prior.statement !== input.statement, "CLINICIAN_CORRECTION_UNCHANGED");
      supersedes = input.supersedes;
    }
  }
  const record = {
    schema: "ekg-clinician-correction-v1",
    analysisId: analysis.analysisId,
    caseId: analysis.caseId,
    analysisSha256,
    reviewerId: input.reviewerId,
    statement: input.statement,
    origin: "CLINICIAN_REVIEWED",
    supersedes,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    diagnosticInterpretationIncluded: false,
    runtimeAuthority: false,
  };
  const correctionId = correctionIdentity(record);
  const artifact = { ...record, correctionId };
  const body = canonicalJson(artifact);
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_CORRECTION_BYTES, "CLINICIAN_CORRECTION_BYTES");
  const artifactHash = sha256(Buffer.from(body, "utf8"));
  const parent = path.join(caseDir, "analyses", analysis.analysisId, "corrections");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = correctionDirectory(caseDir, analysis.analysisId, correctionId);
  if (!fs.existsSync(finalDir)) {
    withCorrectionAdmissionLock(caseDir, analysis.analysisId, () => {
      // Recheck under the lock: a concurrent writer may have published this
      // exact correction (idempotent replay) or filled the last slot first.
      if (fs.existsSync(finalDir)) return;
      // The reader refuses stores above MAX_CORRECTIONS, so a new correction
      // must be refused BEFORE it is published. Counted exactly as the reader
      // counts: every entry in the corrections directory.
      const existing = fs.readdirSync(parent);
      requireCondition(existing.length < MAX_CORRECTIONS, "CLINICIAN_CORRECTION_LIMIT");
    // Keep transient names near the case root. On Windows the final content-addressed
    // correction path can be close to MAX_PATH; adding a mkdtemp suffix beneath that
    // deep parent can fail with ENAMETOOLONG even when the final path itself is valid.
    // The case root is on the same filesystem, so the final publication remains an
    // atomic directory rename.
    const stage = fs.mkdtempSync(path.join(caseDir, ".correction-staging-"));
    try {
      const artifactFile = path.join(stage, "correction.json");
      const hashFile = path.join(stage, "correction.sha256");
      fs.writeFileSync(artifactFile, body, { encoding: "utf8", flag: "wx" });
      fs.writeFileSync(hashFile, `${artifactHash}\n`, { encoding: "ascii", flag: "wx" });
      fsyncFile(artifactFile);
      fsyncFile(hashFile);
      fsyncDirectory(stage);
      try {
        fs.renameSync(stage, finalDir);
      } catch (error) {
        if (![ "EEXIST", "ENOTEMPTY", "EPERM", "EACCES" ].includes(error.code) || !fs.existsSync(finalDir)) throw error;
        const existing = readClinicianCorrection(caseDir, analysis.analysisId, correctionId);
        requireCondition(canonicalJson(existing) === body, "CLINICIAN_CORRECTION_ID_COLLISION");
        removeCorrectionStage(stage, caseDir);
      }
      fsyncDirectory(parent);
    } catch (error) {
      removeCorrectionStage(stage, caseDir);
      throw error;
    }
    });
  }
  const saved = readClinicianCorrection(caseDir, analysis.analysisId, correctionId);
  requireCondition(canonicalJson(saved) === body, "CLINICIAN_CORRECTION_REOPEN_MISMATCH");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === analysisSha256, "CLINICIAN_CORRECTION_ANALYSIS_MUTATED");
  return {
    schema: "ekg-clinician-correction-receipt-v1",
    caseId: analysis.caseId,
    analysisId: analysis.analysisId,
    correctionId,
    path: path.join(finalDir, "correction.json"),
    sha256: artifactHash,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    diagnosticInterpretationIncluded: false,
    runtimeAuthority: false,
    notice: "Engineering output - not clinically validated. Clinician review required.",
  };
}

module.exports = {
  MAX_CORRECTIONS,
  correctionIdentity,
  persistClinicianCorrection,
  readClinicianCorrection,
};
