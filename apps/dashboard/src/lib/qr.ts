/**
 * Tiny QR code renderer for otpauth:// provisioning URIs.
 *
 * First-login is the only place we need to scan anything, and we do not want
 * to pull in a QR dependency for one screen. We implement the minimal subset
 * of QR Model 2 that covers the URIs we emit:
 *
 *   - Byte mode encoding.
 *   - Error correction level L.
 *   - Versions 1–10 (up to ~170 ASCII chars at ECC-L; an otpauth URI for a
 *     Nimiq admin label is well under that).
 *
 * If the input is longer than we can encode we render the URI as text and
 * rely on the copy-to-clipboard button. The operator can always copy/paste
 * the URI into their authenticator manually.
 *
 * The algorithm is a condensed port of the public-domain reference
 * implementation by Project Nayuki (https://www.nayuki.io/page/qr-code-generator-library),
 * trimmed to byte mode + ECC level L.
 */

type Mode = { modeBits: number; charCountBits: (ver: number) => number };

const MODE_BYTE: Mode = {
  modeBits: 0x4,
  charCountBits: (ver) => (ver < 10 ? 8 : ver < 27 ? 16 : 16),
};

// ECC-L codewords per version (1..10), block count at level L, and data
// codewords per block — straight from the QR spec tables.
const ECC_L_TOTAL: Record<number, { totalDataBytes: number; blocks: number; dataPerBlock: number[] }> =
  {
    1: { totalDataBytes: 19, blocks: 1, dataPerBlock: [19] },
    2: { totalDataBytes: 34, blocks: 1, dataPerBlock: [34] },
    3: { totalDataBytes: 55, blocks: 1, dataPerBlock: [55] },
    4: { totalDataBytes: 80, blocks: 1, dataPerBlock: [80] },
    5: { totalDataBytes: 108, blocks: 1, dataPerBlock: [108] },
    6: { totalDataBytes: 136, blocks: 2, dataPerBlock: [68, 68] },
    7: { totalDataBytes: 156, blocks: 2, dataPerBlock: [78, 78] },
    8: { totalDataBytes: 194, blocks: 2, dataPerBlock: [97, 97] },
    9: { totalDataBytes: 232, blocks: 2, dataPerBlock: [116, 116] },
    10: { totalDataBytes: 274, blocks: 4, dataPerBlock: [68, 68, 69, 69] },
  };

const ECC_L_CODEWORDS_PER_BLOCK: Record<number, number> = {
  1: 7,
  2: 10,
  3: 15,
  4: 20,
  5: 26,
  6: 18,
  7: 20,
  8: 24,
  9: 30,
  10: 18,
};

function pickVersion(dataLen: number): number | null {
  for (let v = 1; v <= 10; v++) {
    const capBits = ECC_L_TOTAL[v]!.totalDataBytes * 8 - 4 - MODE_BYTE.charCountBits(v);
    if (dataLen * 8 <= capBits) return v;
  }
  return null;
}

// ---- Reed-Solomon (GF(256)) helpers ----
const RS_EXP = new Uint8Array(256);
const RS_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    RS_EXP[i] = x;
    RS_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  RS_EXP[255] = RS_EXP[0]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return RS_EXP[(RS_LOG[a]! + RS_LOG[b]!) % 255]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j]! ^ gfMul(poly[j]!, 1)) & 0xff;
      next[j + 1] = gfMul(poly[j]!, RS_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGeneratorPoly(eccLen);
  const result = new Uint8Array(eccLen);
  for (const byte of data) {
    const factor = byte ^ result[0]!;
    for (let i = 0; i < eccLen - 1; i++) {
      result[i] = result[i + 1]! ^ gfMul(gen[i + 1]!, factor);
    }
    result[eccLen - 1] = gfMul(gen[eccLen]!, factor);
  }
  return result;
}

// ---- Bit writer ----
class BitBuffer {
  private readonly bits: number[] = [];
  write(value: number, numBits: number): void {
    for (let i = numBits - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  length(): number {
    return this.bits.length;
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) out[i >>> 3]! |= 1 << (7 - (i & 7));
    }
    return out;
  }
}

function buildDataBytes(bytes: Uint8Array, version: number): Uint8Array {
  const info = ECC_L_TOTAL[version]!;
  const bb = new BitBuffer();
  bb.write(MODE_BYTE.modeBits, 4);
  bb.write(bytes.length, MODE_BYTE.charCountBits(version));
  for (const b of bytes) bb.write(b, 8);
  const capBits = info.totalDataBytes * 8;
  const terminator = Math.min(4, capBits - bb.length());
  bb.write(0, terminator);
  while (bb.length() % 8 !== 0) bb.write(0, 1);
  const data = bb.toBytes();
  const out = new Uint8Array(info.totalDataBytes);
  out.set(data);
  const pad = [0xec, 0x11];
  for (let i = data.length, k = 0; i < info.totalDataBytes; i++, k++) {
    out[i] = pad[k & 1]!;
  }
  return out;
}

function interleaveBlocks(dataBytes: Uint8Array, version: number): Uint8Array {
  const info = ECC_L_TOTAL[version]!;
  const ecc = ECC_L_CODEWORDS_PER_BLOCK[version]!;
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < info.blocks; i++) {
    const sz = info.dataPerBlock[i]!;
    const slice = dataBytes.slice(offset, offset + sz);
    dataBlocks.push(slice);
    eccBlocks.push(rsEncode(slice, ecc));
    offset += sz;
  }
  const maxData = Math.max(...info.dataPerBlock);
  const total: number[] = [];
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < info.blocks; b++) {
      if (i < dataBlocks[b]!.length) total.push(dataBlocks[b]![i]!);
    }
  }
  for (let i = 0; i < ecc; i++) {
    for (let b = 0; b < info.blocks; b++) total.push(eccBlocks[b]![i]!);
  }
  return new Uint8Array(total);
}

// ---- Matrix placement ----
function sizeFor(version: number): number {
  return version * 4 + 17;
}

function placeFinders(m: number[][], size: number): void {
  const place = (r: number, c: number): void => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const ry = r + y;
        const cx = c + x;
        if (ry < 0 || ry >= size || cx < 0 || cx >= size) continue;
        const inner =
          (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
          (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
          (y >= 2 && y <= 4 && x >= 2 && x <= 4);
        m[ry]![cx] = inner ? 1 : 0;
      }
    }
  };
  place(0, 0);
  place(0, size - 7);
  place(size - 7, 0);
}

function placeTiming(m: number[][], size: number): void {
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (m[6]![i] === -1) m[6]![i] = v;
    if (m[i]![6] === -1) m[i]![6] = v;
  }
}

function placeDark(m: number[][], version: number): void {
  m[version * 4 + 9]![8] = 1;
}

function reserveFormat(m: number[][], size: number): void {
  for (let i = 0; i < 9; i++) {
    if (m[8]![i] === -1) m[8]![i] = 0;
    if (m[i]![8] === -1) m[i]![8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8]![size - 1 - i] === -1) m[8]![size - 1 - i] = 0;
    if (m[size - 1 - i]![8] === -1) m[size - 1 - i]![8] = 0;
  }
}

function writeData(m: number[][], size: number, bits: Uint8Array): void {
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m[row]![cc] === -1) {
          const byte = bits[bitIdx >>> 3] ?? 0;
          const bit = (byte >>> (7 - (bitIdx & 7))) & 1;
          m[row]![cc] = bit;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(m: number[][], size: number): void {
  // Mask 0: (row + col) % 2 === 0.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFunction(m, size, r, c)) continue;
      if ((r + c) % 2 === 0) m[r]![c] = m[r]![c]! ^ 1;
    }
  }
}

function isFunction(m: number[][], size: number, r: number, c: number): boolean {
  // Finder + separator + format areas around the three corners.
  if (r < 9 && c < 9) return true;
  if (r < 9 && c >= size - 8) return true;
  if (r >= size - 8 && c < 9) return true;
  // Timing rows/cols.
  if (r === 6 || c === 6) return true;
  // Dark module column.
  return false;
}

function writeFormatBits(m: number[][], size: number): void {
  // ECC-L + mask 0 → format data = 0b01000 = 8.
  const data = 0b01000;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) m[8]![i] = (bits >>> i) & 1;
  m[8]![7] = (bits >>> 6) & 1;
  m[8]![8] = (bits >>> 7) & 1;
  m[7]![8] = (bits >>> 8) & 1;
  for (let i = 9; i < 15; i++) m[14 - i]![8] = (bits >>> i) & 1;
  for (let i = 0; i < 8; i++) m[size - 1 - i]![8] = (bits >>> i) & 1;
  for (let i = 8; i < 15; i++) m[8]![size - 15 + i] = (bits >>> i) & 1;
  m[size - 8]![8] = 1;
}

/**
 * Render an otpauth URI as a QR code SVG data URL. Returns `null` if the
 * payload is too large for our capped version range (10).
 */
export function qrSvgDataUrl(text: string, pixel = 6): string | null {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length);
  if (version === null) return null;
  const size = sizeFor(version);
  const m: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => -1),
  );
  placeFinders(m, size);
  placeTiming(m, size);
  placeDark(m, version);
  reserveFormat(m, size);
  const dataBytes = buildDataBytes(bytes, version);
  const interleaved = interleaveBlocks(dataBytes, version);
  writeData(m, size, interleaved);
  applyMask(m, size);
  writeFormatBits(m, size);

  const quiet = 4;
  const total = size + quiet * 2;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" width="${total * pixel}" height="${total * pixel}" role="img" aria-label="TOTP provisioning QR code">`,
  );
  parts.push(`<rect width="${total}" height="${total}" fill="#ffffff"/>`);
  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (m[r]![c] === 1) {
        let w = 1;
        while (c + w < size && m[r]![c + w] === 1) w++;
        rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="${w}" height="1" fill="#000"/>`);
        c += w;
      } else {
        c++;
      }
    }
  }
  parts.push(rects.join(''));
  parts.push('</svg>');
  const svg = parts.join('');
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
