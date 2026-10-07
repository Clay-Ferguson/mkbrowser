import { describe, it, expect } from 'vitest';
import { buildEmailUrl, buildMapUrl, buildPhoneUrl, buildWebUrl, MAP_URL_TEMPLATE } from '../src/shared/objects/objectUrls';

describe('buildMapUrl', () => {
  it('encodes the address into the default Google Maps template', () => {
    expect(buildMapUrl('1600 Amphitheatre Pkwy, Mountain View, CA')).toBe(
      'https://www.google.com/maps/search/?api=1&query=1600%20Amphitheatre%20Pkwy%2C%20Mountain%20View%2C%20CA',
    );
    expect(MAP_URL_TEMPLATE).toContain('{address}');
  });

  it('joins a multi-line address into one query, dropping blank lines', () => {
    expect(buildMapUrl('123 Main St\n  Springfield, IL  \n\n', 'x?q={address}')).toBe(
      'x?q=' + encodeURIComponent('123 Main St, Springfield, IL'),
    );
  });

  it('encodes characters that would break the URL', () => {
    expect(buildMapUrl('Apt #4 & Co', 'x?q={address}')).toBe('x?q=Apt%20%234%20%26%20Co');
  });
});

describe('buildEmailUrl', () => {
  it('builds a mailto: link, keeping the @ literal', () => {
    expect(buildEmailUrl(' jane+work@example.com ')).toBe('mailto:jane%2Bwork@example.com');
  });

  it('encodes characters that would break the URL', () => {
    expect(buildEmailUrl('a b?c#d@example.com')).toBe('mailto:a%20b%3Fc%23d@example.com');
  });

  it('still fills a webmail compose template', () => {
    expect(buildEmailUrl('jane@example.com', 'https://mail.example/compose?to={email}')).toBe(
      'https://mail.example/compose?to=jane@example.com',
    );
  });
});

describe('buildWebUrl', () => {
  it('adds https:// to a value with no scheme', () => {
    expect(buildWebUrl('example.com/page')).toBe('https://example.com/page');
    expect(buildWebUrl('  www.example.com ')).toBe('https://www.example.com');
  });

  it('keeps a value that already has a scheme', () => {
    expect(buildWebUrl('http://example.com')).toBe('http://example.com');
    expect(buildWebUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
    expect(buildWebUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
  });
});

describe('buildPhoneUrl', () => {
  it('keeps a leading + and the digits, dropping punctuation', () => {
    expect(buildPhoneUrl('+1 (555) 123-4567')).toBe('tel:+15551234567');
    expect(buildPhoneUrl(' 555-123-4567 ')).toBe('tel:5551234567');
    expect(buildPhoneUrl('555.123.4567')).toBe('tel:5551234567');
  });

  it('turns a trailing extension into ;ext=', () => {
    expect(buildPhoneUrl('555-123-4567 x89')).toBe('tel:5551234567;ext=89');
    expect(buildPhoneUrl('555-123-4567 ext. 89')).toBe('tel:5551234567;ext=89');
    expect(buildPhoneUrl('555-123-4567 extension 89')).toBe('tel:5551234567;ext=89');
    expect(buildPhoneUrl('+44 20 7946 0958 #12')).toBe('tel:+442079460958;ext=12');
  });

  it('does not link values that are not dialable numbers', () => {
    expect(buildPhoneUrl('')).toBeUndefined();
    expect(buildPhoneUrl('n/a')).toBeUndefined();
    expect(buildPhoneUrl('1-800-FLOWERS')).toBeUndefined();
  });
});
