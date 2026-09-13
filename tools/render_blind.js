const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { verify, DATA } = require("./verify_source");

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

function waveformPath(values, x, y, width, height) {
  let maxAbs = 1;
  for (const value of values) maxAbs = Math.max(maxAbs, Math.abs(value));
  const mid = y + height / 2;
  return values.map((value, index) => {
    const px = x + (index / Math.max(1, values.length - 1)) * width;
    const py = mid - (value / maxAbs) * (height * 0.42);
    return `${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
  }).join(" ");
}

function renderBlind(outputFile) {
  const source = verify();
  const lr = source.records.lr;
  const leads = loadLeadSamples(
    path.join(DATA, "00001_lr.dat"), lr.leads, lr.samples
  );
  const width = 1200;
  const rowHeight = 110;
  const height = rowHeight * lr.leads;
  const names = lr.leadNames;

  const rows = leads.map((values, index) => {
    const y = index * rowHeight;
    const d = waveformPath(values, 70, y + 8, width - 90, rowHeight - 16);
    return [
      `<text x="8" y="${y + 24}" font-size="14">${names[index]}</text>`,
      `<path d="${d}" fill="none" stroke="black" stroke-width="1"/>`,
    ].join("");
  }).join("");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="white"/>`,
    rows,
    `</svg>\n`,
  ].join("");
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, svg, "utf8");
  return {
    schema: "ekg-blinded-render-v1",
    pass: true,
    diagnostic_interpretation_included: false,
    record_identifier_included: false,
    source_sha256: source.hashes["00001_lr.dat"],
    svg_sha256: crypto.createHash("sha256").update(svg).digest("hex"),
    output: outputFile,
  };
}

if (require.main === module) {
  const output = process.argv[2] ||
    path.join(ROOT, "runtime", "blind", "record.svg");
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

module.exports = { loadLeadSamples, renderBlind, waveformPath };
