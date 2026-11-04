// P1-09 image intake: magic bytes, dimensions, metadata stripping (EXIF/GPS, XMP, text), trailing
// data, corrupt files. Fixtures are built here byte by byte; none holds real personal data.
import { describe, expect, it } from 'vitest';
import { ImageError, cleanImage, sniffImage } from '../../src/modules/media/image.ts';
import {
  PRIVATE_MARKER,
  exif,
  jpeg,
  png,
  pngChunk,
  riff,
  vp8l,
  vp8x,
  webpChunk,
} from '../support/images.ts';

const has = (bytes: Buffer, text: string) => bytes.includes(Buffer.from(text, 'latin1'));

describe('sniffImage', () => {
  it('recognises formats by magic bytes only', () => {
    expect(sniffImage(png(2, 2))).toBe('image/png');
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(riff([webpChunk('VP8L', vp8l(3, 2))]))).toBe('image/webp');
    for (const other of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('GIF89a'),
      Buffer.from('%PDF-1.7'),
      Buffer.from('<html>'),
      Buffer.alloc(0),
    ]) {
      expect(sniffImage(other)).toBeNull();
      expect(() => cleanImage(other)).toThrow(new ImageError('unsupported_type'));
    }
  });
});

describe('PNG', () => {
  it('keeps the image, drops text, EXIF, timestamps and trailing data', () => {
    const input = png(
      5,
      3,
      [
        pngChunk('tEXt', Buffer.from(`Author\0${PRIVATE_MARKER}`, 'latin1')),
        pngChunk('iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${PRIVATE_MARKER}`, 'latin1')),
        pngChunk('eXIf', exif(1).subarray(6)),
        pngChunk('tIME', Buffer.alloc(7)),
        pngChunk('sRGB', Buffer.from([0])),
      ],
      Buffer.from(`PK\x03\x04${PRIVATE_MARKER}`, 'latin1'),
    );
    const clean = cleanImage(input);
    expect(clean).toMatchObject({ mime: 'image/png', width: 5, height: 3 });
    expect(has(clean.bytes, PRIVATE_MARKER)).toBe(false);
    expect(has(clean.bytes, 'sRGB')).toBe(true);
    expect([...clean.removed].sort()).toEqual(['eXIf', 'iTXt', 'tEXt', 'tIME', 'trailing-data']);
    // The result is itself a valid PNG that cleans to the same bytes (idempotent).
    expect(cleanImage(clean.bytes).bytes.equals(clean.bytes)).toBe(true);
  });

  it('rejects a bad CRC, a missing IHDR or IEND, and truncation', () => {
    const good = png(2, 2);
    const badCrc = Buffer.from(good);
    badCrc[good.length - 13] = (badCrc[good.length - 13] ?? 0) ^ 0xff; // inside IDAT
    for (const broken of [badCrc, good.subarray(0, good.length - 12), good.subarray(0, 20)]) {
      expect(() => cleanImage(broken)).toThrow(new ImageError('corrupt'));
    }
  });

  it('refuses decompression bombs by their declared size', () => {
    expect(cleanImage(png(6000, 10, [], undefined, { pixels: false })).width).toBe(6000);
    expect(() => cleanImage(png(6001, 10, [], undefined, { pixels: false }))).toThrow(
      new ImageError('dimensions_too_large'),
    );
    expect(() => cleanImage(png(9000, 10, [], undefined, { pixels: false }))).toThrow(
      new ImageError('dimensions_too_large'),
    );
    expect(() => cleanImage(png(7000, 7000, [], undefined, { pixels: false }))).toThrow(
      new ImageError('dimensions_too_large'),
    );
  });
});

describe('JPEG', () => {
  it('drops EXIF (GPS, camera), XMP, IPTC, comments and trailing data', () => {
    const clean = cleanImage(
      jpeg({ trailing: Buffer.from(`<?php ${PRIVATE_MARKER} ?>`, 'latin1') }),
    );
    expect(clean).toMatchObject({ mime: 'image/jpeg', width: 40, height: 30 });
    expect(has(clean.bytes, PRIVATE_MARKER)).toBe(false);
    expect(has(clean.bytes, 'Exif')).toBe(false);
    expect([...clean.removed].sort()).toEqual(['COM', 'EXIF', 'IPTC', 'XMP', 'trailing-data']);
    // The image data survives untouched, stuffed bytes and restart markers included.
    expect(clean.bytes.includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]))).toBe(
      true,
    );
    expect(clean.bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it('keeps only the orientation of a rotated phone photo', () => {
    const clean = cleanImage(jpeg({ orientation: 6 }));
    expect(has(clean.bytes, PRIVATE_MARKER)).toBe(false);
    const at = clean.bytes.indexOf(Buffer.from('Exif\0\0', 'latin1'));
    expect(at).toBeGreaterThan(0);
    // Minimal block: big-endian TIFF, one IFD entry (0x0112 = 6), 36 bytes in total.
    expect(clean.bytes.readUInt16BE(at - 2)).toBe(34);
    expect(clean.bytes.readUInt16BE(at + 16)).toBe(0x0112);
    expect(clean.bytes.readUInt16BE(at + 24)).toBe(6);
    expect(cleanImage(clean.bytes).bytes.equals(clean.bytes)).toBe(true);
  });

  it('rejects truncated files and files without a frame or scan', () => {
    const good = jpeg();
    for (const broken of [
      good.subarray(0, 30),
      good.subarray(0, good.length - 2),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]),
    ]) {
      expect(() => cleanImage(broken)).toThrow(new ImageError('corrupt'));
    }
    expect(() => cleanImage(jpeg({ width: 9000 }))).toThrow(new ImageError('dimensions_too_large'));
  });
});

describe('WebP', () => {
  it('reads lossless dimensions', () => {
    expect(cleanImage(riff([webpChunk('VP8L', vp8l(300, 200))]))).toMatchObject({
      mime: 'image/webp',
      width: 300,
      height: 200,
      removed: [],
    });
  });

  it('drops EXIF and XMP chunks, clears their flags, and drops trailing data', () => {
    const input = riff(
      [
        webpChunk('VP8X', vp8x(64, 48, 0x08 | 0x04 | 0x10)),
        webpChunk('VP8L', vp8l(64, 48)),
        webpChunk('EXIF', exif(1).subarray(6)),
        webpChunk('XMP ', Buffer.from(`<x>${PRIVATE_MARKER}</x>`, 'latin1')),
      ],
      Buffer.from(PRIVATE_MARKER, 'latin1'),
    );
    const clean = cleanImage(input);
    expect(clean).toMatchObject({ width: 64, height: 48 });
    expect(has(clean.bytes, PRIVATE_MARKER)).toBe(false);
    expect([...clean.removed].sort()).toEqual(['EXIF', 'XMP', 'trailing-data']);
    expect((clean.bytes[20] ?? 0) & 0x0c).toBe(0); // EXIF/XMP flags cleared, alpha flag kept
    expect((clean.bytes[20] ?? 0) & 0x10).toBe(0x10);
    expect(clean.bytes.readUInt32LE(4)).toBe(clean.bytes.length - 8);
  });

  it('rejects a RIFF size beyond the file and a WebP without image data', () => {
    const good = riff([webpChunk('VP8L', vp8l(3, 2))]);
    const lying = Buffer.from(good);
    lying.writeUInt32LE(good.length * 4, 4);
    expect(() => cleanImage(lying)).toThrow(new ImageError('corrupt'));
    expect(() => cleanImage(riff([webpChunk('VP8X', vp8x(3, 2, 0))]))).toThrow(
      new ImageError('corrupt'),
    );
  });
});
