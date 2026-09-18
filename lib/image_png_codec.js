"use strict";

const zlib = require("zlib");

const PNG_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;
const MAX_BYTES = 12 * 1024 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function writeChunk(chunks, type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  chunks.push(len, typeBuf, data, crcBuf);
}

function encodeGrayscalePng(image) {
  requireCondition(Array.isArray(image) && image.length > 0, "PNG_ROWS_REQUIRED");
  requireCondition(Array.isArray(image[0]) && image[0].length > 0, "PNG_COLUMNS_REQUIRED");
  const height = image.length;
  const width = image[0].length;
  requireCondition(Number.isInteger(width) && width >= 1 && width <= MAX_WIDTH, "PNG_WIDTH");
  requireCondition(Number.isInteger(height) && height >= 1 && height <= MAX_HEIGHT, "PNG_HEIGHT");
  const raw = Buffer.alloc((width + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    const row = image[y];
    requireCondition(Array.isArray(row) && row.length === width, "PNG_RECTANGULAR");
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < width; x += 1) {
      const v = row[x];
      requireCondition(Number.isInteger(v) && v >= 0 && v <= 255, "PNG_PIXEL_RANGE");
      raw[o] = v;
      o += 1;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [SIGNATURE];
  writeChunk(chunks, "IHDR", ihdr);
  writeChunk(chunks, "IDAT", zlib.deflateSync(raw));
  writeChunk(chunks, "IEND", Buffer.alloc(0));
  return Buffer.concat(chunks);
}

function readChunks(bytes) {
  requireCondition(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, "PNG_BYTES_REQUIRED");
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  requireCondition(buf.length >= 33 && buf.length <= MAX_BYTES, "PNG_SIZE");
  requireCondition(buf.subarray(0, 8).equals(SIGNATURE), "PNG_SIGNATURE");
  const chunks = [];
  let i = 8;
  let seenIend = false;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    requireCondition(length <= MAX_BYTES, "PNG_CHUNK_SIZE");
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    requireCondition(/^[A-Za-z]{4}$/.test(type), "PNG_CHUNK_TYPE");
    const dataStart = i + 8;
    const dataEnd = dataStart + length;
    requireCondition(dataEnd + 4 <= buf.length, "PNG_TRUNCATED");
    const data = buf.subarray(dataStart, dataEnd);
    const expected = buf.readUInt32BE(dataEnd);
    requireCondition(crc32(buf.subarray(i + 4, dataEnd)) === expected, "PNG_CRC");
    chunks.push({ type, data });
    i = dataEnd + 4;
    if (type === "IEND") {
      seenIend = true;
      break;
    }
  }
  requireCondition(seenIend, "PNG_MISSING_IEND");
  return chunks;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  let dst = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    requireCondition(filter >= 0 && filter <= 4, "PNG_FILTER");
    for (let x = 0; x < stride; x += 1) {
      const filt = raw[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst + x - stride] : 0;
      const c = y > 0 && x >= bpp ? out[dst + x - stride - bpp] : 0;
      let recon;
      if (filter === 0) recon = filt;
      else if (filter === 1) recon = (filt + a) & 255;
      else if (filter === 2) recon = (filt + b) & 255;
      else if (filter === 3) recon = (filt + Math.floor((a + b) / 2)) & 255;
      else recon = (filt + paeth(a, b, c)) & 255;
      out[dst + x] = recon;
    }
    src += stride;
    dst += stride;
  }
  requireCondition(src === raw.length, "PNG_RAW_SIZE");
  return out;
}

function decodePngToGrayscale(bytes) {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  requireCondition(ihdr && ihdr.data.length === 13, "PNG_IHDR");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const compression = ihdr.data[10];
  const filter = ihdr.data[11];
  const interlace = ihdr.data[12];
  requireCondition(width >= 1 && width <= MAX_WIDTH, "PNG_WIDTH");
  requireCondition(height >= 1 && height <= MAX_HEIGHT, "PNG_HEIGHT");
  requireCondition(bitDepth === 8, "PNG_BIT_DEPTH");
  requireCondition(colorType === 0 || colorType === 2 || colorType === 6, "PNG_COLOR_TYPE");
  requireCondition(compression === 0 && filter === 0, "PNG_COMPRESSION");
  requireCondition(interlace === 0, "PNG_INTERLACE");
  const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const idat = chunks.filter((c) => c.type === "IDAT").map((c) => c.data);
  requireCondition(idat.length > 0, "PNG_IDAT");
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw new Error("PNG_INFLATE");
  }
  const expected = (width * bpp + 1) * height;
  requireCondition(inflated.length === expected, "PNG_INFLATED_SIZE");
  const recon = unfilter(inflated, width, height, bpp);
  const image = [];
  for (let y = 0; y < height; y += 1) {
    const row = Array(width);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * bpp;
      if (bpp === 1) row[x] = recon[i];
      else {
        const r = recon[i];
        const g = recon[i + 1];
        const b = recon[i + 2];
        row[x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    image.push(row);
  }
  return {
    schema: "ekg-image-png-decode-v1",
    width,
    height,
    colorType,
    image,
    ...PNG_GOVERNANCE,
  };
}

module.exports = {
  PNG_GOVERNANCE,
  decodePngToGrayscale,
  encodeGrayscalePng,
};
