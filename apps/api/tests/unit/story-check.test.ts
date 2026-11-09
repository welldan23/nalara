// P5-09: the API's judgement of the Pemeriksa agent's quotes. Pure functions; TEST data only.
import { describe, expect, it } from 'vitest';
import { draftText, judgeCheck, normalize, numbersIn } from '../../src/modules/stories/check.ts';

const SOURCE =
  'Badan Pusat Statistik: inflasi tahunan Oktober 2026 sebesar 2,80 persen. Ekspor naik 1.250 juta dolar.';
const DRAFT = 'Inflasi Oktober 2026 tercatat 2,8 persen. Ekspor naik 1.250 juta dolar AS.';
const first = {
  claim: 'Inflasi Oktober 2026 tercatat 2,8 persen.',
  source: 1,
  evidence: 'inflasi tahunan Oktober 2026 sebesar 2,80 persen',
  supported: true,
};
const second = {
  claim: 'Ekspor naik 1.250 juta dolar',
  source: 1,
  evidence: 'Ekspor naik 1.250 juta dolar',
  supported: true,
};
const claims = [first, second];

describe('story check', () => {
  it('reads numbers as values and leaves years out', () => {
    expect([...numbersIn('2,8 dan 2.80 persen, Rp1.250.000, tahun 2026, 6 bulan')]).toEqual([
      '2.8',
      '1250000',
      '6',
    ]);
    expect([...numbersIn('1,250.5 (English)')]).toEqual(['1250.5']);
  });

  it('ignores case, quote marks and whitespace when matching quotes', () => {
    expect(normalize('“Kata”  Menteri\n—  hari ini')).toBe('"kata" menteri - hari ini');
  });

  it('passes when every quote exists, every number is backed and a primary source is used', () => {
    expect(
      judgeCheck(DRAFT, [{ primary: true, text: SOURCE }], {
        claims,
        sensitive: false,
        reason: 'ok',
      }),
    ).toEqual({ status: 'passed', problems: [] });
  });

  it('holds on a number no quote backs', () => {
    const outcome = judgeCheck(`${DRAFT} Defisit 3 persen.`, [{ primary: true, text: SOURCE }], {
      claims,
      sensitive: false,
      reason: 'ok',
    });
    expect(outcome.status).toBe('held');
    expect(outcome.problems.join(' ')).toMatch(/belum dicocokkan ke sumber: 3/);
  });

  it('holds on a quote the draft or the archive does not contain', () => {
    const invented = judgeCheck(DRAFT, [{ primary: true, text: SOURCE }], {
      claims: [{ ...first, evidence: 'inflasi 2,8 persen menurut BPS' }, second],
      sensitive: false,
      reason: 'ok',
    });
    expect(invented.problems.join(' ')).toMatch(/tidak ditemukan di arsipnya/);
    const notInDraft = judgeCheck(DRAFT, [{ primary: true, text: SOURCE }], {
      claims: [{ ...first, claim: 'Inflasi turun tajam.' }, second],
      sensitive: false,
      reason: 'ok',
    });
    expect(notInDraft.problems.join(' ')).toMatch(/tidak ada di draft/);
  });

  it('holds when a claim number differs from its quote, or no primary source is used', () => {
    const wrong = judgeCheck('Inflasi 3,1 persen.', [{ primary: true, text: SOURCE }], {
      claims: [
        {
          claim: 'Inflasi 3,1 persen.',
          source: 1,
          evidence: 'sebesar 2,80 persen',
          supported: true,
        },
      ],
      sensitive: false,
      reason: 'ok',
    });
    expect(wrong.problems.join(' ')).toMatch(/angka 3.1 tidak ada di kutipan/);
    const media = judgeCheck(DRAFT, [{ primary: false, text: SOURCE }], {
      claims,
      sensitive: false,
      reason: 'ok',
    });
    expect(media.problems.join(' ')).toMatch(/sumber resmi primer/);
  });

  it('holds on anything unsupported, sensitive or empty', () => {
    expect(
      judgeCheck(DRAFT, [{ primary: true, text: SOURCE }], {
        claims: [{ ...first, supported: false }, second],
        sensitive: false,
        reason: 'ok',
      }).status,
    ).toBe('held');
    expect(
      judgeCheck(DRAFT, [{ primary: true, text: SOURCE }], {
        claims,
        sensitive: true,
        reason: 'Menyebut tersangka',
      }).problems[0],
    ).toMatch(/sensitif/);
    expect(
      judgeCheck('Tanpa angka.', [{ primary: true, text: SOURCE }], {
        claims: [],
        sensitive: false,
        reason: 'ok',
      }).status,
    ).toBe('held');
  });

  it('turns a draft body into the text a reader sees', () => {
    expect(
      draftText('Judul', 'Dek', [
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Apa' }] },
        {
          type: 'stat',
          value: '2,8',
          unit: 'persen',
          period: 'Oktober 2026',
          label: 'Inflasi',
          citationId: '01900000-0000-7000-8000-00000000000a',
        },
      ]),
    ).toBe('Judul\nDek\nApa\nInflasi: 2,8 persen (Oktober 2026)');
  });
});
