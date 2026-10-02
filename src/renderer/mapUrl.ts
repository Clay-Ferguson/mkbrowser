/**
 * URL opened in the system browser when an address is clicked. `{address}` is replaced with the
 * URL-encoded address. Hard-coded for now; meant to become a user setting later.
 */
export const MAP_URL_TEMPLATE = 'https://www.google.com/maps/search/?api=1&query={address}';

/**
 * The map URL for an address. A multi-line (YAML `|`) address has its lines joined with ", " so
 * the map service reads it as one query.
 */
export function buildMapUrl(address: string, template: string = MAP_URL_TEMPLATE): string {
  const query = address
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(', ');
  return template.replace('{address}', encodeURIComponent(query));
}
