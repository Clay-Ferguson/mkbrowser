// URLs that object cards (e.g. a person's address or email) open in the system browser. Each
// template's placeholder is replaced with the URL-encoded value. Hard-coded for now; meant to
// become user settings later.

/** Map search for an address. `{address}` is the address. */
export const MAP_URL_TEMPLATE = 'https://www.google.com/maps/search/?api=1&query={address}';

/**
 * New message in webmail rather than `mailto:`, which goes to the OS mail client. `{email}` is
 * the recipient. Gmail's compose view also accepts `&su=` (subject) and `&body=`.
 */
export const EMAIL_URL_TEMPLATE = 'https://mail.google.com/mail/?view=cm&fs=1&to={email}';

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

/** The compose URL for a new email to `email`. */
export function buildEmailUrl(email: string, template: string = EMAIL_URL_TEMPLATE): string {
  return template.replace('{email}', encodeURIComponent(email.trim()));
}
