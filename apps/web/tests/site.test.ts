// P1-08 helpers: public origin parsing and XML escaping for the RSS feed.
import { afterEach, describe, expect, it } from 'vitest';
import { absoluteUrl, siteOrigin } from '../lib/site';
import { xmlEscape } from '../lib/xml';

const original = process.env['APP_BASE_URL'];
afterEach(() => {
  if (original === undefined) delete process.env['APP_BASE_URL'];
  else process.env['APP_BASE_URL'] = original;
});

describe('siteOrigin', () => {
  it('accepts a bare origin and builds absolute URLs from it', () => {
    process.env['APP_BASE_URL'] = 'https://nalara.example';
    const origin = siteOrigin();
    expect(origin?.origin).toBe('https://nalara.example');
    expect(absoluteUrl(origin ?? new URL('https://x.invalid'), '/artikel/a-b')).toBe(
      'https://nalara.example/artikel/a-b',
    );
  });

  it.each([undefined, '', 'nalara.example', 'https://nalara.example/path', 'javascript:alert(1)'])(
    'refuses %s (no canonical URLs from a bad origin)',
    (value) => {
      if (value === undefined) delete process.env['APP_BASE_URL'];
      else process.env['APP_BASE_URL'] = value;
      expect(siteOrigin()).toBeNull();
    },
  );
});

describe('xmlEscape', () => {
  it('escapes every XML special character', () => {
    expect(xmlEscape(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });

  it('escapes ampersands first, so entities are not double-decoded', () => {
    expect(xmlEscape('&lt;')).toBe('&amp;lt;');
  });
});
