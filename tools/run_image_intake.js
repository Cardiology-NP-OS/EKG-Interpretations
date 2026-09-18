"use strict";

const fs = require("fs");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageCase } = require("../lib/image_case_store");

function parseArgs(argv) {
  const out = { fixture: false, outDir: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") out.fixture = true;
    else if (arg === "--out" && argv[i + 1]) {
      out.outDir = argv[i + 1];
      i += 1;
    } else throw new Error("INTAKE_CLI_ARG");
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.fixture) throw new Error("INTAKE_CLI_FIXTURE_ONLY");
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
  });
  const result = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "cli://synthetic-fixture", projectGold: false },
    connectMeasurements: true,
  });
  const payload = {
    report: result.report,
    roiCount: result.rois.roiCount,
    pxPerMm: result.grid.pxPerMm,
    digitizedLeadCount: result.digitized.leadCount,
    measurementBeats: result.measurements ? result.measurements.coverage.beats : 0,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  if (args.outDir) {
    const receipt = persistImageCase(path.resolve(args.outDir), result);
    fs.writeFileSync(path.join(args.outDir, "intake-report.json"), `${JSON.stringify(result.report, null, 2)}\n`);
    process.stderr.write(`${receipt.path}\n`);
  }
}

if (require.main === module) main();
module.exports = { parseArgs };
