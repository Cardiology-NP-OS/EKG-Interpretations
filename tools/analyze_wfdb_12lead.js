"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runMultiLeadSignalIntelligence } = require("../lib/multilead_signal_intelligence");

const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error("ANALYZE12_ARG_FORMAT");
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`ANALYZE12_ARG_VALUE_REQUIRED:${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  for (const key of ["header", "data", "config", "source-id"])
    if (!args[key]) throw new Error(`ANALYZE12_ARG_REQUIRED:${key}`);
  if (!SAFE_SOURCE_ID.test(args["source-id"])) throw new Error("ANALYZE12_SOURCE_ID_UNSAFE");
  return args;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseLeadList(value) {
  if (value === undefined) return undefined;
  const leads = value.split(",").map(x => x.trim()).filter(Boolean);
  if (!leads.length) throw new Error("ANALYZE12_LEADS_EMPTY");
  if (new Set(leads).size !== leads.length) throw new Error("ANALYZE12_LEADS_DUPLICATE");
  return leads;
}

function buildMultiLeadAnalysis(args) {
  const headerBytes = fs.readFileSync(path.resolve(args.header));
  const dataBytes = fs.readFileSync(path.resolve(args.data));
  const configBytes = fs.readFileSync(path.resolve(args.config));
  const config = JSON.parse(configBytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (!config.measurement || !config.phenotypes) throw new Error("ANALYZE12_CONFIG_SECTIONS_REQUIRED");
  if (typeof config.thresholdAuthority !== "string" || !config.thresholdAuthority.trim())
    throw new Error("ANALYZE12_CONFIG_AUTHORITY_REQUIRED");
  const leadNames = parseLeadList(args.leads) || config.leads;
  const analysis = runMultiLeadSignalIntelligence({
    headerText: headerBytes.toString("utf8"),
    dataBuffer: dataBytes,
    leadNames,
    measurementConfig: config.measurement,
    phenotypeConfig: config.phenotypes,
    thresholdAuthority: config.thresholdAuthority,
    provenance: {
      sourceKind: "LOCAL_WFDB_MULTILEAD_SIGNAL_INTELLIGENCE_INPUT",
      locator: args["source-id"],
      assetSha256: sha256(dataBytes),
    },
  });
  return {
    ...analysis,
    sourceFiles: {
      headerSha256: sha256(headerBytes),
      dataSha256: sha256(dataBytes),
      configSha256: sha256(configBytes),
      pathsEmbedded: false,
    },
    configuration: {
      sha256: sha256(configBytes),
      thresholdAuthority: config.thresholdAuthority,
      requestedLeads: leadNames || null,
    },
    workflow: "tools/analyze_wfdb_12lead.js",
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const artifact = buildMultiLeadAnalysis(args);
    const json = JSON.stringify(artifact, null, 2) + "\n";
    if (args.out) {
      const output = path.resolve(args.out);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, json, "utf8");
      console.log(JSON.stringify({
        schema: "ekg-multilead-signal-intelligence-write-v1",
        pass: true,
        output,
        processedLeads: artifact.processedLeads.length,
        skippedLeads: artifact.failureAccounting.skipped,
        diagnosticInterpretationIncluded: false,
        diagnosticRuntime: "GOVERNED_INACTIVE",
      }));
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-multilead-signal-intelligence-write-v1",
      pass: false,
      error: String(error.message || error),
      diagnosticInterpretationIncluded: false,
      diagnosticRuntime: "GOVERNED_INACTIVE",
    }));
    process.exit(1);
  }
}

module.exports = {
  buildMultiLeadAnalysis,
  parseArgs,
  parseLeadList,
  sha256,
};
