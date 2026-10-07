// URLs that object cards (an `address`, `email`, `url`, or `phone` property) open via the system. Each
// template's placeholder is replaced with the URL-encoded value. Hard-coded for now; meant to
// become user settings later.

/** Map search for an address. `{address}` is the address. */
export const MAP_URL_TEMPLATE = 'https://www.google.com/maps/search/?api=1&query={address}';

/**
 * New message in the system's default mail client. `{email}` is the recipient. A webmail compose
 * URL works here too, e.g. Gmail's `https://mail.google.com/mail/?view=cm&fs=1&to={email}`.
 */
export const EMAIL_URL_TEMPLATE = 'mailto:{email}';

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

/**
 * The compose URL for a new email to `email`. The address is percent-encoded so characters like
 * `?`, `#`, `&` or spaces can't break the URL, except for its `@`, which mail clients expect to
 * see literally in a `mailto:` address.
 */
export function buildEmailUrl(email: string, template: string = EMAIL_URL_TEMPLATE): string {
  return template.replace('{email}', encodeURIComponent(email.trim()).replace(/%40/g, '@'));
}

/**
 * The URL to open for a `url` property. A value with no scheme (`example.com/page`) gets
 * `https://`; a value with an explicit scheme is kept as is, so one the main process won't open
 * (anything but http/https/file) simply does nothing when clicked.
 */
export function buildWebUrl(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The `tel:` URL for a `phone` property, or undefined when the value isn't a dialable number
 * (in which case it is shown as plain text). The number keeps a leading `+` and its digits, with
 * the punctuation people write between them dropped: `+1 (555) 123-4567` → `tel:+15551234567`.
 * A trailing extension (`x89`, `ext. 89`, `extension 89`, `#89`) becomes RFC 3966's `;ext=89`.
 * A value with letters in the number itself (a vanity number like `1-800-FLOWERS`) is not linked,
 * since dropping the letters would dial the wrong number.
 */
export function buildPhoneUrl(phone: string): string | undefined {
  const match = /^(.*?)(?:\s*(?:ext\.?|extension|x|#)\s*(\d+))?$/i.exec(phone.trim());
  const number = match?.[1] ?? '';
  const ext = match?.[2];
  if (/[a-z]/i.test(number)) return undefined;
  const digits = number.replace(/\D/g, '');
  if (digits === '') return undefined;
  const prefix = number.startsWith('+') ? '+' : '';
  return `tel:${prefix}${digits}${ext ? `;ext=${ext}` : ''}`;
}
