const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA = path.resolve(
  ROOT, "..", "EKG_INTERPRETATIONS_DATA", "ptbxl", "1.0.3", "record_00001"
);
const DATA = path.resolve(process.env.EKG_PTBXL_RECORD_DIR || DEFAULT_DATA);
const manifest = require(path.join(ROOT, "manifests", "PTBXL_RECORD_00001.json"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseHeader(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const [record, leads, sampleRate, samples] = lines[0].trim().split(/\s+/);
  const leadNames = lines.slice(1).map(line => line.trim().split(/\s+/).at(-1));
  return {
    record,
    leads: Number(leads),
    sampleRate: Number(sampleRate),
    samples: Number(samples),
    leadNames,
  };
}

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function verify() {
  const hashes = {};
  for (const [name, expected] of Object.entries(manifest.expected)) {
    const file = path.join(DATA, name);
    requireCondition(fs.existsSync(file), `SOURCE_MISSING:${name}`);
    const actual = sha256(file);
    requireCondition(actual === expected, `SOURCE_SHA256_MISMATCH:${name}`);
    hashes[name] = actual;
  }

  const lr = parseHeader(path.join(DATA, "00001_lr.hea"));
  const hr = parseHeader(path.join(DATA, "00001_hr.hea"));
  const canonicalLeads = ["I","II","III","AVR","AVL","AVF","V1","V2","V3","V4","V5","V6"];
  requireCondition(lr.record === "00001_lr", "LR_RECORD_ID");
  requireCondition(hr.record === "00001_hr", "HR_RECORD_ID");
  requireCondition(lr.leads === 12 && hr.leads === 12, "LEAD_COUNT");
  requireCondition(lr.sampleRate === 100 && lr.samples === 1000, "LR_SHAPE");
  requireCondition(hr.sampleRate === 500 && hr.samples === 5000, "HR_SHAPE");
  requireCondition(
    JSON.stringify(lr.leadNames) === JSON.stringify(canonicalLeads),
    "LR_LEADS"
  );
  requireCondition(
    JSON.stringify(hr.leadNames) === JSON.stringify(canonicalLeads),
    "HR_LEADS"
  );
  requireCondition(
    fs.statSync(path.join(DATA, "00001_lr.dat")).size === 12 * 1000 * 2,
    "LR_DATA_SIZE"
  );
  requireCondition(
    fs.statSync(path.join(DATA, "00001_hr.dat")).size === 12 * 5000 * 2,
    "HR_DATA_SIZE"
  );

  const result = {
    schema: "ekg-source-verification-v1",
    pass: true,
    evidence_tier: "engineering_harness_only",
    clinical_accuracy_claimed: false,
    data_root: DATA,
    hashes,
    records: { lr, hr },
  };
  return result;
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verify(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-source-verification-v1",
      pass: false,
      error: String(error.message || error),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = { verify, parseHeader, sha256, DATA };
