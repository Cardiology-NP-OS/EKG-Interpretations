const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LEADS = ["I","II","III","AVR","AVL","AVF","V1","V2","V3","V4","V5","V6"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeSignal(file, samples, leadCount = 12) {
  const buffer = Buffer.alloc(samples * leadCount * 2);
  for (let sample = 0; sample < samples; sample += 1) {
    for (let lead = 0; lead < leadCount; lead += 1) {
      const value = ((sample * 13 + lead * 17) % 601) - 300;
      buffer.writeInt16LE(value, (sample * leadCount + lead) * 2);
    }
  }
  fs.writeFileSync(file, buffer);
}

function header(record, dataFile, sampleRate, samples) {
  const lines = [`${record} 12 ${sampleRate} ${samples}`];
  for (const lead of LEADS) {
    lines.push(`${dataFile} 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`);
  }
  return lines.join("\n") + "\n";
}

function createSyntheticFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "00001_lr.hea"),
    header("00001_lr", "00001_lr.dat", 100, 1000));
  fs.writeFileSync(path.join(root, "00001_hr.hea"),
    header("00001_hr", "00001_hr.dat", 500, 5000));
  writeSignal(path.join(root, "00001_lr.dat"), 1000);
  writeSignal(path.join(root, "00001_hr.dat"), 5000);
  fs.writeFileSync(
    path.join(root, "ptbxl_database.csv"),
    "ecg_id,filename_lr,filename_hr\n1,synthetic_lr,synthetic_hr\n"
  );
  const names = [
    "ptbxl_database.csv",
    "00001_lr.dat", "00001_lr.hea",
    "00001_hr.dat", "00001_hr.hea",
  ];
  const expected = Object.fromEntries(
    names.map(name => [name, sha256(path.join(root, name))])
  );
  return {
    schema: "ekg-synthetic-source-manifest-v1",
    dataset: "SYNTHETIC-CONTRACT-FIXTURE",
    version: "1",
    purpose: "ci-contract-only",
    clinical_data: false,
    expected,
  };
}

module.exports = { createSyntheticFixture, LEADS, sha256 };
