const fs = require("fs");
const path = require("path");
const {
  DATA,
  SOURCE_MANIFEST,
  verifyAt,
} = require("./verify_source");
const {
  compareRecordShapes,
  inspectRecord,
} = require("../lib/wfdb_signal");

function buildInspection(dataRoot = DATA, sourceManifest = SOURCE_MANIFEST) {
  const verified = verifyAt(dataRoot, sourceManifest);
  const lr = inspectRecord(
    fs.readFileSync(path.join(dataRoot, "00001_lr.hea"), "utf8"),
    fs.readFileSync(path.join(dataRoot, "00001_lr.dat"))
  );
  const hr = inspectRecord(
    fs.readFileSync(path.join(dataRoot, "00001_hr.hea"), "utf8"),
    fs.readFileSync(path.join(dataRoot, "00001_hr.dat"))
  );
  return {
    schema: "ekg-source-inspection-report-v1",
    evidenceTier: "engineering_harness_only",
    clinicalAccuracyClaimed: false,
    diagnosticInterpretationIncluded: false,
    sourceFilesVerified: Object.keys(verified.hashes).length,
    sourceHashes: verified.hashes,
    pairConsistency: compareRecordShapes(lr, hr),
    records: {
      lowRate: lr,
      highRate: hr,
    },
  };
}

function parseOutputArg(argv) {
  const index = argv.indexOf("--out");
  if (index === -1) return null;
  if (!argv[index + 1]) throw new Error("OUTPUT_PATH_REQUIRED");
  return path.resolve(argv[index + 1]);
}

if (require.main === module) {
  try {
    const report = buildInspection();
    const json = JSON.stringify(report, null, 2) + "\n";
    const output = parseOutputArg(process.argv.slice(2));
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, json, "utf8");
      console.log(JSON.stringify({
        schema: "ekg-source-inspection-write-v1",
        pass: true,
        output,
        clinicalAccuracyClaimed: false,
      }));
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-source-inspection-report-v1",
      pass: false,
      error: String(error.message || error),
      clinicalAccuracyClaimed: false,
    }, null, 2));
    process.exit(1);
  }
}

module.exports = { buildInspection, parseOutputArg };
