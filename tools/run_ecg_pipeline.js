"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runExecutableEcgPipeline } = require("../lib/ecg_execution_pipeline");

const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/;
function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error("EXECUTE_ARG_FORMAT");
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`EXECUTE_ARG_VALUE_REQUIRED:${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  for (const key of ["header", "data", "config", "source-id", "out-dir"])
    if (!args[key]) throw new Error(`EXECUTE_ARG_REQUIRED:${key}`);
  if (!SAFE_SOURCE_ID.test(args["source-id"])) throw new Error("EXECUTE_SOURCE_ID_UNSAFE");
  return args;
}
function buildExecutionArtifact(args) {
  const headerBytes = fs.readFileSync(path.resolve(args.header));
  const dataBytes = fs.readFileSync(path.resolve(args.data));
  const configBytes = fs.readFileSync(path.resolve(args.config));
  const config = JSON.parse(configBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const result = runExecutableEcgPipeline({
    headerText: headerBytes.toString("utf8"),
    dataBuffer: dataBytes,
    config,
    provenance: {
      sourceKind: "LOCAL_WFDB_EXECUTION_INPUT",
      locator: args["source-id"],
      assetSha256: sha256(dataBytes),
    },
  });
  const { svg, ...rendering } = result.rendering;
  return {
    artifact: {
      ...result,
      rendering: { ...rendering, svgFile: "waveform.svg", pathsEmbedded: false },
      sourceFiles: {
        headerSha256: sha256(headerBytes),
        dataSha256: sha256(dataBytes),
        configSha256: sha256(configBytes),
        pathsEmbedded: false,
      },
      operatorSurface: "tools/run_ecg_pipeline.js",
      localPathsEmbedded: false,
    },
    svg,
  };
}
function writeExecution(args) {
  const built = buildExecutionArtifact(args);
  const outDir = path.resolve(args["out-dir"]);
  fs.mkdirSync(outDir, { recursive: true });
  const analysisPath = path.join(outDir, "analysis.json");
  const svgPath = path.join(outDir, "waveform.svg");
  fs.writeFileSync(analysisPath, JSON.stringify(built.artifact, null, 2) + "\n", "utf8");
  fs.writeFileSync(svgPath, built.svg, "utf8");
  return {
    schema: "ekg-executable-signal-pipeline-write-v1",
    pass: true,
    analysisPath,
    svgPath,
    renderingSha256: built.artifact.rendering.svgSha256,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    clinicalAuthorityAdded: false,
  };
}
if (require.main === module) {
  try { console.log(JSON.stringify(writeExecution(parseArgs(process.argv.slice(2))))); }
  catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-executable-signal-pipeline-write-v1",
      pass: false,
      error: String(error.message || error),
      diagnosticRuntime: "GOVERNED_INACTIVE",
      clinicalAuthorityAdded: false,
    }));
    process.exit(1);
  }
}
module.exports = { buildExecutionArtifact, parseArgs, sha256, writeExecution };
