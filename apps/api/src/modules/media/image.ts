// Image intake without native code (P1-09, ADR-001: no sharp). Three formats only, recognised by
// their magic bytes, never by file name or declared type: PNG, JPEG, WebP. No SVG (scriptable), no
// GIF. Each file is re-assembled from the parts a browser needs to draw it; everything else is
// dropped: EXIF (camera, GPS location, time), XMP, IPTC, comments, text chunks, and any bytes after
// the end of the image (polyglot files). Pixels are never decoded or re-encoded here.
//
// A phone photo's rotation lives in EXIF. Dropping it would show the photo sideways, so for JPEG
// the orientation value alone is written back as a minimal EXIF block with nothing else in it.
import { crc32 } from 'node:zlib';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export const IMAGE_MIMES: readonly ImageMime[] = ['image/png', 'image/jpeg', 'image/webp'];

/** Longest side and total pixels: refuse decompression bombs before any browser sees them. */
export const MAX_DIMENSION = 6000;
export const MAX_PIXELS = 36_000_000;

export interface CleanImage {
  readonly mime: ImageMime;
  readonly width: number;
  readonly height: number;
  readonly bytes: Buffer;
  /** Names of the metadata parts that were removed (for the audit log; never their contents). */
  readonly removed: readonly string[];
}

export type ImageRule = 'unsupported_type' | 'corrupt' | 'dimensions_too_large';

export class ImageError extends Error {
  readonly rule: ImageRule;
  constructor(rule: ImageRule) {
    super(`image rejected: ${rule}`);
    this.name = 'ImageError';
    this.rule = rule;
  }
}

const corrupt = (): never => {
  throw new ImageError('corrupt');
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImage(bytes: Buffer): ImageMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Recognise, check and strip an uploaded image. Throws ImageError with a stable rule. */
export function cleanImage(bytes: Buffer): CleanImage {
  const mime = sniffImage(bytes);
  if (mime === null) throw new ImageError('unsupported_type');
  const result =
    mime === 'image/png'
      ? cleanPng(bytes)
      : mime === 'image/jpeg'
        ? cleanJpeg(bytes)
        : cleanWebp(bytes);
  const { width, height } = result;
  if (width < 1 || height < 1) corrupt();
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new ImageError('dimensions_too_large');
  }
  return { mime, ...result };
}

type Stripped = Omit<CleanImage, 'mime'>;

// --- PNG: chunk list with CRCs (RFC 2083). ---

// Everything needed to draw the image, colour management included. Text (tEXt/zTXt/iTXt), EXIF
// (eXIf), timestamps (tIME), animation (acTL/fcTL/fdAT) and unknown chunks are dropped.
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'cICP',
  'sBIT',
  'bKGD',
  'pHYs',
]);

function cleanPng(bytes: Buffer): Stripped {
  const kept: Buffer[] = [PNG_SIGNATURE];
  const removed = new Set<string>();
  let position = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  let ended = false;
  let first = true;
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position);
    const end = position + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) corrupt();
    const type = bytes.toString('latin1', position + 4, position + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) corrupt();
    const stored = bytes.readUInt32BE(end - 4);
    if (crc32(bytes.subarray(position + 4, end - 4)) !== stored) corrupt();
    if (first) {
      if (type !== 'IHDR' || length !== 13) corrupt();
      width = bytes.readUInt32BE(position + 8);
      height = bytes.readUInt32BE(position + 12);
      first = false;
    }
    if (PNG_KEEP.has(type)) {
      kept.push(bytes.subarray(position, end));
      if (type === 'IDAT') sawData = true;
    } else {
      removed.add(type);
    }
    position = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || !sawData) corrupt();
  if (position < bytes.length) removed.add('trailing-data');
  return { width, height, bytes: Buffer.concat(kept), removed: [...removed] };
}

// --- JPEG: marker segments (ITU T.81). ---

const isSof = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function exifOrientation(segment: Buffer): number {
  // segment: FF E1 len(2) "Exif\0\0" TIFF…
  try {
    const tiff = 10;
    const order = segment.toString('latin1', tiff, tiff + 2);
    const little = order === 'II';
    if (!little && order !== 'MM') return 1;
    const u16 = (at: number) => (little ? segment.readUInt16LE(at) : segment.readUInt16BE(at));
    const u32 = (at: number) => (little ? segment.readUInt32LE(at) : segment.readUInt32BE(at));
    if (u16(tiff + 2) !== 42) return 1;
    const ifd = tiff + u32(tiff + 4);
    const count = u16(ifd);
    for (let index = 0; index < count && index < 512; index += 1) {
      const entry = ifd + 2 + index * 12;
      if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    // Out-of-range reads: treat as "no orientation".
  }
  return 1;
}

/** APP1 with a big-endian TIFF header and one IFD entry: Orientation. Nothing else. */
function orientationSegment(orientation: number): Buffer {
  const segment = Buffer.alloc(36);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(34, 2);
  segment.write('Exif\0\0', 4, 'latin1');
  segment.write('MM', 10, 'latin1');
  segment.writeUInt16BE(42, 12);
  segment.writeUInt32BE(8, 14);
  segment.writeUInt16BE(1, 18);
  segment.writeUInt16BE(0x0112, 20);
  segment.writeUInt16BE(3, 22);
  segment.writeUInt32BE(1, 24);
  segment.writeUInt16BE(orientation, 28);
  segment.writeUInt32BE(0, 32);
  return segment;
}

function cleanJpeg(bytes: Buffer): Stripped {
  const head: Buffer[] = [bytes.subarray(0, 2)];
  const body: Buffer[] = [];
  const removed = new Set<string>();
  let position = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let sawScan = false;
  let ended = false;
  while (position < bytes.length) {
    if (bytes[position] !== 0xff) corrupt();
    while (bytes[position + 1] === 0xff) position += 1; // fill bytes
    const marker = bytes[position + 1] ?? corrupt();
    if (marker === 0xd9) {
      body.push(bytes.subarray(position, position + 2));
      position += 2;
      ended = true;
      break;
    }
    // Stuffing, TEM, restart and a second SOI cannot start a segment here.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) corrupt();
    if (position + 4 > bytes.length) corrupt();
    const length = bytes.readUInt16BE(position + 2);
    const end = position + 2 + length;
    if (length < 2 || end > bytes.length) corrupt();
    const segment = bytes.subarray(position, end);
    const code = marker;
    const label = (offset: number, text: string) =>
      segment.toString('latin1', 4 + offset, 4 + offset + text.length) === text;

    if (code === 0xda) {
      // Start of scan: the segment, then entropy-coded data up to the next real marker.
      body.push(segment);
      let scan = end;
      while (scan + 1 < bytes.length) {
        if (bytes[scan] === 0xff) {
          const next = bytes[scan + 1] ?? 0;
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }
        scan += 1;
      }
      body.push(bytes.subarray(end, scan));
      sawScan = true;
      position = scan;
      continue;
    }
    if (isSof(code)) {
      if (length < 8) corrupt();
      height = bytes.readUInt16BE(position + 5);
      width = bytes.readUInt16BE(position + 7);
      body.push(segment);
    } else if (code === 0xc4 || code === 0xdb || code === 0xdd || code === 0xcc || code === 0xdc) {
      // Huffman and quantisation tables, restart interval, arithmetic coding, number of lines
      body.push(segment);
    } else if (code === 0xe0 && label(0, 'JFIF\0')) {
      head.push(segment);
    } else if (code === 0xe2 && label(0, 'ICC_PROFILE\0')) {
      body.push(segment); // colour profile: no personal data, needed for correct colours
    } else if (code === 0xee && label(0, 'Adobe')) {
      body.push(segment); // colour transform flag for CMYK/YCCK files
    } else if (code === 0xe1 && label(0, 'Exif\0\0')) {
      orientation = exifOrientation(segment);
      removed.add('EXIF');
    } else if (code === 0xe1) {
      removed.add('XMP');
    } else if (code === 0xed) {
      removed.add('IPTC');
    } else if (code === 0xfe) {
      removed.add('COM');
    } else {
      removed.add(
        code >= 0xe0 && code <= 0xef ? `APP${String(code - 0xe0)}` : `0x${code.toString(16)}`,
      );
    }
    position = end;
  }
  if (!ended || !sawScan || width === 0) corrupt();
  if (position < bytes.length) removed.add('trailing-data');
  if (orientation !== 1) head.push(orientationSegment(orientation));
  return { width, height, bytes: Buffer.concat([...head, ...body]), removed: [...removed] };
}

// --- WebP: RIFF chunks (RFC 9649). ---

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH']);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function cleanWebp(bytes: Buffer): Stripped {
  const riffSize = bytes.readUInt32LE(4);
  const fileEnd = 8 + riffSize;
  if (riffSize < 4 || fileEnd > bytes.length) corrupt();
  const kept: Buffer[] = [];
  const removed = new Set<string>();
  let position = 12;
  let width = 0;
  let height = 0;
  let first = true;
  let sawImage = false;
  while (position + 8 <= fileEnd) {
    const fourcc = bytes.toString('latin1', position, position + 4);
    const size = bytes.readUInt32LE(position + 4);
    const dataStart = position + 8;
    const dataEnd = dataStart + size;
    const padded = dataEnd + (size % 2);
    if (dataEnd > fileEnd) corrupt();
    const data = bytes.subarray(dataStart, dataEnd);
    if (first) {
      if (fourcc === 'VP8X' && size >= 10) {
        width = 1 + data.readUIntLE(4, 3);
        height = 1 + data.readUIntLE(7, 3);
      } else if (fourcc === 'VP8 ' && size >= 10) {
        if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) corrupt();
        width = data.readUInt16LE(6) & 0x3fff;
        height = data.readUInt16LE(8) & 0x3fff;
      } else if (fourcc === 'VP8L' && size >= 5) {
        if (data[0] !== 0x2f) corrupt();
        const b1 = data[1] ?? 0;
        const b2 = data[2] ?? 0;
        const b3 = data[3] ?? 0;
        const b4 = data[4] ?? 0;
        width = 1 + (b1 | ((b2 & 0x3f) << 8));
        height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
      } else {
        corrupt();
      }
      first = false;
    }
    if (WEBP_KEEP.has(fourcc)) {
      if (fourcc === 'VP8X') {
        const chunk = Buffer.from(bytes.subarray(position, Math.min(padded, fileEnd)));
        chunk[8] = (chunk[8] ?? 0) & ~(VP8X_EXIF | VP8X_XMP);
        kept.push(chunk);
      } else {
        kept.push(bytes.subarray(position, Math.min(padded, fileEnd)));
      }
      if (fourcc === 'VP8 ' || fourcc === 'VP8L' || fourcc === 'ANMF') sawImage = true;
    } else {
      removed.add(fourcc.trim());
    }
    position = padded;
  }
  if (!sawImage) corrupt();
  if (fileEnd < bytes.length) removed.add('trailing-data');
  const chunks = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + chunks.length, 4);
  header.write('WEBP', 8, 'latin1');
  return { width, height, bytes: Buffer.concat([header, chunks]), removed: [...removed] };
}
