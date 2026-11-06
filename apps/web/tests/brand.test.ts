import { describe, expect, it } from 'vitest';
import { joinNames } from '../components/brand';

describe('joinNames (the "Berakar pada …" line)', () => {
  it('reads as plain Indonesian for one, two and three publishers', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['BPS'])).toBe('BPS');
    expect(joinNames(['BPS', 'BI'])).toBe('BPS dan BI');
    expect(joinNames(['BPS', 'BI', 'OJK'])).toBe('BPS, BI, dan OJK');
  });
});
