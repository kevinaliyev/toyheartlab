/**
 * Zero-dependency client-side GIF89a encoder with 4x4 Bayer ordered dithering
 * and 256-color (6x7x6 RGB + 4 grays) palette for fast, clean shader loop exports.
 */

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function buildPalette256() {
  const palette = new Uint8Array(256 * 3);
  let idx = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 7; g++) {
      for (let b = 0; b < 6; b++) {
        palette[idx * 3] = Math.round((r * 255) / 5);
        palette[idx * 3 + 1] = Math.round((g * 255) / 6);
        palette[idx * 3 + 2] = Math.round((b * 255) / 5);
        idx++;
      }
    }
  }
  const grays = [36, 96, 156, 216];
  for (let i = 0; i < 4; i++) {
    palette[idx * 3] = grays[i];
    palette[idx * 3 + 1] = grays[i];
    palette[idx * 3 + 2] = grays[i];
    idx++;
  }
  return palette;
}

function quantizeFrameBayer(rgba, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    const bayerRow = BAYER_4X4[y & 3];
    for (let x = 0; x < width; x++) {
      const p = (rowOff + x) * 4;
      const d = (bayerRow[x & 3] / 16 - 0.5) * 42;
      const r = Math.max(0, Math.min(255, rgba[p] + d));
      const g = Math.max(0, Math.min(255, rgba[p + 1] + d));
      const b = Math.max(0, Math.min(255, rgba[p + 2] + d));
      const ri = Math.min(5, Math.floor((r * 6) / 256));
      const gi = Math.min(6, Math.floor((g * 7) / 256));
      const bi = Math.min(5, Math.floor((b * 6) / 256));
      out[rowOff + x] = ri * 42 + gi * 6 + bi;
    }
  }
  return out;
}

function lzwEncode(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bytes = [];
  let bitBuf = 0;
  let bitCount = 0;

  function writeBits(code, size) {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  }

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map();

  function resetDict() {
    dict.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  }

  writeBits(clearCode, codeSize);
  let prefix = indices[0];

  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
    } else {
      writeBits(prefix, codeSize);
      if (nextCode < 4096) {
        dict.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        writeBits(clearCode, codeSize);
        resetDict();
      }
      prefix = k;
    }
  }

  writeBits(prefix, codeSize);
  writeBits(eoiCode, codeSize);
  if (bitCount > 0) {
    bytes.push(bitBuf & 0xff);
  }
  return bytes;
}

function writeUint16(buf, val) {
  buf.push(val & 0xff, (val >> 8) & 0xff);
}

export function encodeGIF({ width, height, frames, delayCs = 4 }) {
  const palette = buildPalette256();
  const out = [];

  // Header: GIF89a
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);

  // Logical Screen Descriptor
  writeUint16(out, width);
  writeUint16(out, height);
  out.push(0xf7, 0x00, 0x00); // Global Color Table (256 colors), 8-bit

  // Global Color Table
  for (let i = 0; i < palette.length; i++) {
    out.push(palette[i]);
  }

  // Netscape 2.0 Application Extension (infinite loop)
  out.push(0x21, 0xff, 0x0b);
  const appId = 'NETSCAPE2.0';
  for (let i = 0; i < appId.length; i++) out.push(appId.charCodeAt(i));
  out.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const rgba of frames) {
    // Graphic Control Extension
    out.push(0x21, 0xf9, 0x04, 0x04);
    writeUint16(out, delayCs);
    out.push(0x00, 0x00);

    // Image Descriptor
    out.push(0x2c);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, width);
    writeUint16(out, height);
    out.push(0x00);

    // Image Data
    const minCodeSize = 8;
    out.push(minCodeSize);
    const indices = quantizeFrameBayer(rgba, width, height);
    const lzwBytes = lzwEncode(indices, minCodeSize);
    for (let i = 0; i < lzwBytes.length; i += 255) {
      const chunkLen = Math.min(255, lzwBytes.length - i);
      out.push(chunkLen);
      for (let j = 0; j < chunkLen; j++) {
        out.push(lzwBytes[i + j]);
      }
    }
    out.push(0x00); // Block terminator
  }

  // Trailer
  out.push(0x3b);
  return new Blob([new Uint8Array(out)], { type: 'image/gif' });
}
