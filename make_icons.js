/**
 * make_icons.js — reads icon.png, removes white background, resizes to
 * 16/32/48/128 px and saves as transparent PNGs.
 * Run: node make_icons.js   (no extra dependencies)
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const c   = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, c]);
}

// ── PNG encoder (RGBA, 8-bit) ─────────────────────────────────────────────────
function encodeRGBA(rgba, width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // filter: None
    rgba.copy(row, 1, y * width * 4, (y + 1) * width * 4);
    rows.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Paeth predictor ───────────────────────────────────────────────────────────
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

// ── PNG decoder — colorType 2 (RGB) and 6 (RGBA), 8-bit ──────────────────────
function decodePNG(filePath) {
  const buf = fs.readFileSync(filePath);
  let width, height, colorType;
  const idats = [];
  let off = 8;

  while (off < buf.length) {
    const len  = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    off += 12 + len;

    if (type === 'IHDR') {
      width     = data.readUInt32BE(0);
      height    = data.readUInt32BE(4);
      const bd  = data[8];
      colorType = data[9];
      if (bd !== 8 || (colorType !== 2 && colorType !== 6))
        throw new Error(`Unsupported PNG: bitDepth=${bd} colorType=${colorType}`);
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') break;
  }

  const bpp    = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw    = zlib.inflateSync(Buffer.concat(idats));
  const rgba   = Buffer.alloc(width * height * 4);
  const prev   = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const base   = y * (stride + 1);
    const filter = raw[base];
    const cur    = new Uint8Array(stride);

    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i];
      const a = i >= bpp ? cur[i - bpp]  : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      switch (filter) {
        case 0: cur[i] =  x;                             break;
        case 1: cur[i] = (x + a)              & 0xFF;   break;
        case 2: cur[i] = (x + b)              & 0xFF;   break;
        case 3: cur[i] = (x + ((a + b) >> 1)) & 0xFF;   break;
        case 4: cur[i] = (x + paeth(a, b, c)) & 0xFF;   break;
        default: throw new Error(`Unknown PNG filter: ${filter}`);
      }
    }
    prev.set(cur);

    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      const src = x * bpp;
      rgba[dst]   = cur[src];
      rgba[dst+1] = cur[src+1];
      rgba[dst+2] = cur[src+2];
      rgba[dst+3] = bpp === 4 ? cur[src+3] : 255;
    }
  }

  return { width, height, rgba };
}

// ── Background removal ────────────────────────────────────────────────────────
// BFS flood-fill seeded from every edge pixel.
// Uses Euclidean distance from white in RGB space — catches JPEG compression
// artifacts (near-white pixels that a per-channel threshold would miss).
function removeBackground(rgba, width, height) {
  const DIST_SQ = 40 * 40; // pixels within distance 40 of white are background
  const visited = new Uint8Array(width * height);
  const queue   = [];

  const push = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    queue.push(idx);
  };

  // Seed entire border (not just corners) for robustness
  for (let x = 0; x < width;  x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y);  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const px  = idx * 4;
    const dr  = 255 - rgba[px], dg = 255 - rgba[px+1], db = 255 - rgba[px+2];

    if (dr*dr + dg*dg + db*db <= DIST_SQ) {
      rgba[px+3] = 0; // transparent
      const x = idx % width, y = (idx / width) | 0;
      push(x - 1, y); push(x + 1, y);
      push(x, y - 1); push(x, y + 1);
    }
  }
}

// ── Area-average resize with premultiplied alpha ───────────────────────────────
// Each output pixel is the weighted average of all source pixels it covers.
// This is essential for heavy downsampling (e.g. 400 → 16) — bilinear
// only samples 4 source pixels and produces aliasing/noise at large ratios.
function resizeAreaAverage(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4); // initialised to 0 (transparent)

  for (let dy = 0; dy < dstH; dy++) {
    // Exact source region this output row covers
    const sy0 = dy       * srcH / dstH;
    const sy1 = (dy + 1) * srcH / dstH;
    const iy0 = Math.floor(sy0), iy1 = Math.ceil(sy1);

    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = dx       * srcW / dstW;
      const sx1 = (dx + 1) * srcW / dstW;
      const ix0 = Math.floor(sx0), ix1 = Math.ceil(sx1);

      // Accumulate in premultiplied-alpha space so transparent pixels don't
      // bleed their RGB colour into neighbouring opaque pixels.
      let accR = 0, accG = 0, accB = 0, accA = 0, accW = 0;

      for (let sy = iy0; sy < iy1; sy++) {
        if (sy >= srcH) continue;
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);

        for (let sx = ix0; sx < ix1; sx++) {
          if (sx >= srcW) continue;
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const w  = wx * wy;

          const pi = (sy * srcW + sx) * 4;
          const a  = src[pi + 3];          // 0–255

          // Premultiply: weight by coverage AND by alpha
          accR += src[pi]   * a * w;
          accG += src[pi+1] * a * w;
          accB += src[pi+2] * a * w;
          accA += a * w;
          accW += w;
        }
      }

      const di = (dy * dstW + dx) * 4;
      if (accA > 0) {
        // Un-premultiply RGB; alpha is weighted average of source alphas
        dst[di]   = Math.min(255, Math.round(accR / accA));
        dst[di+1] = Math.min(255, Math.round(accG / accA));
        dst[di+2] = Math.min(255, Math.round(accB / accA));
        dst[di+3] = Math.min(255, Math.round(accA / accW));
      }
      // else: fully transparent → dst stays 0,0,0,0
    }
  }

  return dst;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const srcPath = path.join(__dirname, 'icon.png');
console.log('Reading', srcPath);

const { width, height, rgba } = decodePNG(srcPath);
console.log(`Decoded: ${width}x${height}`);

removeBackground(rgba, width, height);
console.log('Background removed (Euclidean distance from white ≤ 40)');

const outDir = path.join(__dirname, 'rcn-extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const resized = resizeAreaAverage(rgba, width, height, size, size);
  const png     = encodeRGBA(resized, size, size);
  const file    = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`  icon${size}.png  (${png.length} bytes)`);
}

console.log('\nDone.');
