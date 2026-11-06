// P4-03 chart axis ticks: round values that cover the data, including flat and negative series.
import { describe, expect, it } from 'vitest';
import { niceTicks } from '../components/chart';

describe('niceTicks', () => {
  it('covers the range with round steps', () => {
    expect(niceTicks(0, 2.8)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0, 1.9)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(niceTicks(0, 16310)).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(niceTicks(-1.2, 3.4)).toEqual([-2, -1, 0, 1, 2, 3, 4]);
  });

  it('opens a flat series into a visible range', () => {
    const ticks = niceTicks(5, 5);
    expect(ticks[0]).toBeLessThan(5);
    expect(ticks.at(-1)).toBeGreaterThan(5);
  });
});
