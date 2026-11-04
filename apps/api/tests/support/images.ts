// Image fixtures for P1-09 tests, built byte by byte. PNGs decode in a browser; the JPEG and WebP
// builders are structurally valid with filler image data. No fixture holds real personal data:
// SECRET stands in for the GPS position and photographer name a real photo would carry.
import { crc32, deflateSync } from 'node:zlib';

export const SECRET = 'GPS-LAT-6.2088-LON-106.8456-NAMA-FOTOGRAFER';

// --- PNG ---
export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
export function png(
  width: number,
  height: number,
  extra: Buffer[] = [],
  trailing = Buffer.alloc(0),
  options: { readonly pixels?: boolean } = {},
) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  // Real rows (filter byte + RGB) so a browser can draw it; dimension tests skip the pixels.
  const raw =
    options.pixels === false
      ? Buffer.alloc(16)
      : Buffer.alloc(height * (1 + width * 3), 0x7f).fill(0, 0, 1);
  if (options.pixels !== false) {
    for (let row = 0; row < height; row += 1) raw[row * (1 + width * 3)] = 0;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
    trailing,
  ]);
}

// --- JPEG (structurally valid; the entropy data is filler) ---
export function segment(marker: number, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}
export function exif(orientation: number): Buffer {
  // "Exif\0\0" + little-endian TIFF, IFD0 with Orientation and an ASCII tag holding SECRET.
  const text = Buffer.from(`${SECRET}\0`, 'latin1');
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x010e, 10); // ImageDescription
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(text.length, 14);
  tiff.writeUInt32LE(tiff.length, 18);
  tiff.writeUInt16LE(0x0112, 22); // Orientation
  tiff.writeUInt16LE(3, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt16LE(orientation, 30);
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, text]);
}
export function jpeg(options: { orientation?: number; trailing?: Buffer; width?: number } = {}) {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(30, 1); // height
  sof.writeUInt16BE(options.width ?? 40, 3); // width
  sof[5] = 3;
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, exif(options.orientation ?? 1)),
    segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x>${SECRET}</x>`, 'latin1')),
    segment(0xed, Buffer.from(`Photoshop 3.0\0${SECRET}`, 'latin1')),
    segment(0xfe, Buffer.from(SECRET, 'latin1')),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xc0, sof),
    segment(0xc4, Buffer.alloc(30, 2)),
    segment(0xda, sos),
    // Entropy-coded data with a stuffed 0xFF00 and a restart marker inside.
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    Buffer.from([0xff, 0xd9]),
    options.trailing ?? Buffer.alloc(0),
  ]);
}

// --- WebP (lossless header; the bitstream is filler) ---
export function riff(chunks: Buffer[], trailing = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body, trailing]);
}
export function webpChunk(fourcc: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
export function vp8l(width: number, height: number): Buffer {
  const w = width - 1;
  const h = height - 1;
  return Buffer.from([
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
    0,
    0,
  ]);
}
export function vp8x(width: number, height: number, flags: number): Buffer {
  const data = Buffer.alloc(10);
  data[0] = flags;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return data;
}
