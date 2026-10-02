import { describe, it, expect } from 'vitest';
import { buildMapUrl, MAP_URL_TEMPLATE } from '../src/renderer/mapUrl';

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
