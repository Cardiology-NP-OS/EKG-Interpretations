"use strict";
const assert = require("assert");
const zlib = require("zlib");
const { encodeGrayscalePng, decodePngToGrayscale, PNG_GOVERNANCE } = require("../lib/image_png_codec");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function ihdr(width, height, colorType) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = colorType;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return chunk("IHDR", data);
}

function encodedPng({ width, height, colorType, raw, beforeIdat = [], splitIdatWith = null }) {
  const compressed = zlib.deflateSync(raw);
  const pieces = [SIGNATURE, ihdr(width, height, colorType), ...beforeIdat];
  if (splitIdatWith) {
    const mid = Math.max(1, Math.floor(compressed.length / 2));
    pieces.push(chunk("IDAT", compressed.subarray(0, mid)), splitIdatWith, chunk("IDAT", compressed.subarray(mid)));
  } else {
    pieces.push(chunk("IDAT", compressed));
  }
  pieces.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(pieces);
}

function externalPngPreflight(image) {
  return {
    source_kind: "phone_photo",
    format: "png",
    readable: true,
    quality_flags: [],
    lead_labels: ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"],
    lead_labels_verified: true,
    presented_as_12_lead: true,
    lead_mislabel_suspected: false,
    evidence_complete: true,
    signal_quality_sufficient: true,
    source_identity_established: true,
    serial_comparison_requested: false,
    serial_pair_verified: true,
    machine_text_conflict: false,
    calibration: {
      paper_speed_mm_s: 25,
      gain_mm_mV: 10,
      calibration_source: "visible",
      local_scale_trustworthy: true,
    },
    geometry: {
      rotation_or_skew: false,
      perspective_distortion: false,
      distorted_aspect_ratio: false,
    },
    image: { width_px: image[0].length, height_px: image.length },
    metadata_claims: [],
    measurements: [],
    embedded_text: [],
  };
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

test("PNG codec roundtrips an 8-bit grayscale matrix", () => {
  const src = [
    [255, 16, 196],
    [228, 16, 255],
  ];
  const bytes = encodeGrayscalePng(src);
  const out = decodePngToGrayscale(bytes);
  assert.strictEqual(out.width, 3);
  assert.strictEqual(out.height, 2);
  assert.deepStrictEqual(out.image, src);
  assert.strictEqual(out.alphaPolicy, "NONE");
  assert.strictEqual(PNG_GOVERNANCE.activation, "NOT_ELIGIBLE");
  assert.throws(() => decodePngToGrayscale(bytes.subarray(0, 20)), /PNG_/);
});

test("RGB PNG decodes to deterministic luma", () => {
  const bytes = encodedPng({
    width: 3,
    height: 1,
    colorType: 2,
    raw: Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
  });
  const out = decodePngToGrayscale(bytes);
  assert.deepStrictEqual(out.image, [[76, 150, 29]]);
  assert.strictEqual(out.colorType, 2);
  assert.strictEqual(out.alphaPolicy, "NONE");
});

test("RGBA transparency is composited over white before luma use", () => {
  const bytes = encodedPng({
    width: 3,
    height: 1,
    colorType: 6,
    raw: Buffer.from([0,
      0, 0, 0, 0,
      0, 0, 0, 255,
      0, 0, 0, 128,
    ]),
  });
  const out = decodePngToGrayscale(bytes);
  assert.deepStrictEqual(out.image, [[255, 0, 127]]);
  assert.strictEqual(out.alphaPolicy, "COMPOSITE_OVER_WHITE");
});

test("unsupported tRNS transparency fails closed", () => {
  const trns = chunk("tRNS", Buffer.from([0, 0, 0, 0, 0, 0]));
  const bytes = encodedPng({
    width: 1,
    height: 1,
    colorType: 2,
    raw: Buffer.from([0, 0, 0, 0]),
    beforeIdat: [trns],
  });
  assert.throws(() => decodePngToGrayscale(bytes), /PNG_TRANSPARENCY_UNSUPPORTED/);
});

test("unsupported critical chunks fail closed", () => {
  const bytes = encodedPng({
    width: 1,
    height: 1,
    colorType: 0,
    raw: Buffer.from([0, 0]),
    beforeIdat: [chunk("ABCD", Buffer.alloc(0))],
  });
  assert.throws(() => decodePngToGrayscale(bytes), /PNG_CRITICAL_CHUNK_UNSUPPORTED/);
});

test("IDAT chunks must remain contiguous", () => {
  const bytes = encodedPng({
    width: 1,
    height: 1,
    colorType: 0,
    raw: Buffer.from([0, 0]),
    splitIdatWith: chunk("tEXt", Buffer.from("x\0y")),
  });
  assert.throws(() => decodePngToGrayscale(bytes), /PNG_IDAT_ORDER/);
});

test("bytes after IEND are rejected", () => {
  const bytes = encodeGrayscalePng([[0]]);
  assert.throws(() => decodePngToGrayscale(Buffer.concat([bytes, Buffer.from([0])])), /PNG_TRAILING_BYTES/);
});

test("inflate output is bounded by declared raster geometry", () => {
  const bytes = encodedPng({
    width: 1,
    height: 1,
    colorType: 0,
    raw: Buffer.alloc(4096),
  });
  assert.throws(() => decodePngToGrayscale(bytes), /PNG_INFLATE/);
});

test("unsupported grayscale-alpha PNG fails closed instead of ignoring alpha", () => {
  const bytes = encodedPng({
    width: 1,
    height: 1,
    colorType: 4,
    raw: Buffer.from([0, 0, 0]),
  });
  assert.throws(() => decodePngToGrayscale(bytes), /PNG_COLOR_TYPE/);
});

test("intake decodes PNG bytes when no raster matrix is supplied", () => {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const bytes = encodeGrayscalePng(paper.image);
  const out = runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "png",
    bytes,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPngPreflight(paper.image),
    provenance: { locator: "case://png-1", projectGold: false },
  });
  assert.strictEqual(out.report.encodedSource, "png-v1");
  assert.strictEqual(out.report.roiSource, "DISCOVERED_3X4_RHYTHM");
  assert.strictEqual(out.rois.completeTwelveLeadPanels, true);
  assert.strictEqual(out.report.diagnosticInterpretationIncluded, false);
});

test("JPEG without a raster still fails closed", () => {
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "jpeg",
    provenance: { locator: "case://jpeg-1", projectGold: false },
  }), /INTAKE_ENCODED_IMAGE_RASTERIZATION_REQUIRED/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ schema: "ekg-image-png-tests-v1", pass: true, passed, total: passed }));
