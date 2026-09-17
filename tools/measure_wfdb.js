"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runWaveformMeasurementPipeline } = require("../lib/signal_measurement_pipeline");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error("MEASURE_ARG_FORMAT");
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`MEASURE_ARG_VALUE_REQUIRED:${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  for (const key of ["header", "data", "lead", "config", "source-id"])
    if (!args[key]) throw new Error(`MEASURE_ARG_REQUIRED:${key}`);
  return args;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function buildWorkflow(args) {
  const headerPath = path.resolve(args.header);
  const dataPath = path.resolve(args.data);
  const configPath = path.resolve(args.config);
  const headerBytes = fs.readFileSync(headerPath);
  const dataBytes = fs.readFileSync(dataPath);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  const result = runWaveformMeasurementPipeline({
    headerText: headerBytes.toString("utf8"),
    dataBuffer: dataBytes,
    leadName: args.lead,
    config,
    provenance: {
      sourceKind: "LOCAL_WFDB_MEASUREMENT_INPUT",
      locator: args["source-id"],
      assetSha256: sha256(dataBytes),
    },
  });
  return {
    ...result,
    sourceFiles: {
      headerSha256: sha256(headerBytes),
      dataSha256: sha256(dataBytes),
      pathsEmbedded: false,
    },
    workflow: "tools/measure_wfdb.js",
  };
}
if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = buildWorkflow(args);
    const json = JSON.stringify(report, null, 2) + "\n";
    if (args.out) {
      const output = path.resolve(args.out);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, json, "utf8");
      console.log(JSON.stringify({
        schema: "ekg-waveform-measurement-write-v1",
        pass: true,
        output,
        diagnosticInterpretationIncluded: false,
        diagnosticRuntime: "GOVERNED_INACTIVE",
      }));
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-waveform-measurement-write-v1",
      pass: false,
      error: String(error.message || error),
      diagnosticInterpretationIncluded: false,
      diagnosticRuntime: "GOVERNED_INACTIVE",
    }));
    process.exit(1);
  }
}

module.exports = { buildWorkflow, parseArgs, sha256 };
