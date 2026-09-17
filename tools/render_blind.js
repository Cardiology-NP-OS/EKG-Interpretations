const fs = require("fs");
const path = require("path");
const {
  verifyAt,
  DATA,
  SOURCE_MANIFEST,
} = require("./verify_source");
const { renderWaveformSvg, waveformPath } = require("../lib/waveform_rendering");

const ROOT = path.resolve(__dirname, "..");

function loadLeadSamples(file, leadCount, samplesPerLead) {
  const buf = fs.readFileSync(file);
  if (buf.length !== leadCount * samplesPerLead * 2) {
    throw new Error("UNEXPECTED_SIGNAL_BYTES");
  }
  const leads = Array.from({ length: leadCount }, () => []);
  for (let sample = 0; sample < samplesPerLead; sample += 1) {
    for (let lead = 0; lead < leadCount; lead += 1) {
      const offset = (sample * leadCount + lead) * 2;
      leads[lead].push(buf.readInt16LE(offset));
    }
  }
  return leads;
}
function renderBlindAt(dataRoot, outputFile, sourceManifest = SOURCE_MANIFEST) {
  const source = verifyAt(dataRoot, sourceManifest);
  const lr = source.records.lr;
  const samples = loadLeadSamples(
    path.join(dataRoot, "00001_lr.dat"), lr.leads, lr.samples
  );
  const rendering = renderWaveformSvg({
    leads: samples.map((values,index) => ({label:lr.leadNames[index],samples:values})),
    width: 1200,
    rowHeight: 110,
  });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, rendering.svg, "utf8");
  return {
    schema: "ekg-blinded-render-v1",
    pass: true,
    diagnostic_interpretation_included: false,
    record_identifier_included: false,
    source_sha256: source.hashes["00001_lr.dat"],
    svg_sha256: rendering.svgSha256,
    output: outputFile,
  };
}

function renderBlind(outputFile) {
  return renderBlindAt(DATA, outputFile, SOURCE_MANIFEST);
}
if (require.main === module) {
  const output = process.argv[2] || path.join(ROOT, "runtime", "blind", "record.svg");
  try {
    console.log(JSON.stringify(renderBlind(output), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-blinded-render-v1",
      pass: false,
      error: String(error.message || error),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  loadLeadSamples,
  renderBlind,
  renderBlindAt,
  waveformPath,
};
