"use strict";

const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const { isBuiltin } = require("module");
const { readStoreFile } = require("./image_case_store");

const IMPLEMENTATION_FILES = Object.freeze([
  "image_digitization", "image_signal_analysis", "signal_measurement_pipeline", "signal_measurement_contract",
  "signal_delineation_contract", "wfdb_signal", "rhythm_feature_contract", "candidate_phenotype_engine",
].map(name => `lib/${name}.js`));
const ROOT = path.resolve(__dirname, "..");
const ENTRY = "lib/image_signal_analysis.js";
const MAX_ARTIFACT_BYTES = 1024 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function loadImageAnalysis() {
  const modules = new Map();
  const artifacts = new Map();
  let sealed = false;
  let executionIdentity;
  let implementations;

  function readArtifact(file) {
    return readStoreFile(path.join(ROOT, file), MAX_ARTIFACT_BYTES, "IMAGE_ANALYSIS_IMPLEMENTATION_FILE_REQUIRED");
  }

  function assertCurrentArtifacts() {
    for (const [file, identity] of artifacts) {
      const body = readArtifact(file);
      requireCondition(body.length === identity.bytes && sha256(body) === identity.sha256, "IMAGE_ANALYSIS_LOADED_IMPLEMENTATION_MISMATCH");
    }
  }

  function snapshot() {
    requireCondition(sealed, "IMAGE_ANALYSIS_EXECUTION_NOT_READY");
    assertCurrentArtifacts();
    return JSON.parse(JSON.stringify({ implementations, executionIdentity }));
  }

  function verify(analysis) {
    requireCondition(
      Array.isArray(analysis.implementations) && analysis.implementations.length === IMPLEMENTATION_FILES.length &&
      analysis.implementations.every((row, index) => row && row.file === IMPLEMENTATION_FILES[index] &&
        typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256)),
      "IMAGE_ANALYSIS_IMPLEMENTATION_IDENTITY",
    );
    const current = snapshot();
    requireCondition(analysis.implementations.every((row, index) => row.sha256 === current.implementations[index].sha256),
      "IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH");
    requireCondition(analysis.executionIdentity !== undefined, "IMAGE_ANALYSIS_EXECUTION_IDENTITY_REQUIRED");
    requireCondition(JSON.stringify(analysis.executionIdentity) === JSON.stringify(current.executionIdentity),
      "IMAGE_ANALYSIS_EXECUTION_IDENTITY_MISMATCH");
  }

  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    requireCondition(!sealed, "IMAGE_ANALYSIS_EXECUTION_DEPENDENCY_UNDECLARED");
    requireCondition(
      /^lib\/[a-z0-9_]+\.js$/.test(file) || file === "evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json",
      "IMAGE_ANALYSIS_EXECUTION_DEPENDENCY_UNSUPPORTED",
    );
    const body = readArtifact(file);
    const source = body.toString("utf8");
    requireCondition(Buffer.from(source, "utf8").equals(body), "IMAGE_ANALYSIS_IMPLEMENTATION_ENCODING");
    artifacts.set(file, { file, bytes: body.length, sha256: sha256(body) });
    const loaded = { exports: {} };
    modules.set(file, loaded);
    if (file.endsWith(".json")) {
      loaded.exports = JSON.parse(source);
    } else {
      const filename = path.join(ROOT, file);
      const localRequire = request => {
        if (isBuiltin(request)) return require(request);
        requireCondition(request.startsWith("./") || request.startsWith("../"), "IMAGE_ANALYSIS_EXECUTION_DEPENDENCY_UNSUPPORTED");
        const resolved = path.resolve(path.dirname(filename), request);
        const relative = path.relative(ROOT, path.extname(resolved) ? resolved : `${resolved}.js`).split(path.sep).join("/");
        return load(relative);
      };
      if (file === ENTRY) loaded.imageAnalysisArtifact = Object.freeze({ snapshot, verify });
      const execute = vm.compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], { filename });
      execute(loaded.exports, localRequire, loaded, filename, path.dirname(filename));
    }
    return loaded.exports;
  }

  const analysis = load(ENTRY);
  load("lib/image_digitization.js");
  implementations = IMPLEMENTATION_FILES.map(file => ({ file, sha256: artifacts.get(file).sha256 }));
  executionIdentity = {
    schema: "ekg-image-analysis-execution-v1",
    entryPoint: ENTRY,
    loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES",
    artifactScope: "ANALYSIS_MODULE_GRAPH_AND_DIGITIZATION_SUPPORT_NOT_EXTRACTION_EXECUTION",
    artifacts: [...artifacts.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  };
  sealed = true;
  assertCurrentArtifacts();
  return Object.freeze(analysis);
}

module.exports = { loadImageAnalysis };
