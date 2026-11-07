// P5-04: the chat commands are parsed strictly; anything else gets the help text.
import { describe, expect, it } from 'vitest';
import { parseChatCommand } from '../../src/modules/stories/chat.ts';

describe('parseChatCommand', () => {
  it('reads the four commands, with or without #, in any case', () => {
    expect(parseChatCommand('lihat 12')).toEqual({ kind: 'view', number: 12 });
    expect(parseChatCommand('  Lewati #7 ')).toEqual({ kind: 'skip', number: 7 });
    expect(parseChatCommand('judul 12: Harga beras naik, ini sebabnya')).toEqual({
      kind: 'edit',
      number: 12,
      field: 'title',
      value: 'Harga beras naik, ini sebabnya',
    });
    expect(parseChatCommand('RINGKAS #3 :  satu\n dua ')).toEqual({
      kind: 'edit',
      number: 3,
      field: 'dek',
      value: 'satu dua',
    });
    expect(parseChatCommand('caption 3: teks')).toMatchObject({ field: 'dek' });
  });

  it('keeps everything after the colon as data, including colons and markup', () => {
    expect(parseChatCommand('judul 1: BI: suku bunga <b>tetap</b>')).toMatchObject({
      value: 'BI: suku bunga <b>tetap</b>',
    });
  });

  it('ignores anything else', () => {
    for (const text of [
      'halo',
      'lihat',
      'lihat dua',
      'judul 12 tanpa titik dua',
      '/status',
      'hapus 12',
    ]) {
      expect(parseChatCommand(text)).toBeNull();
    }
  });
});
