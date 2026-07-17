import { HighlightStyle } from '@codemirror/language';
import { oneDarkHighlightStyle, color } from '@codemirror/theme-one-dark';
import { tags } from '@lezer/highlight';

/**
 * Muted blue-grey for de-emphasized prose (blockquote bodies, struck-through text).
 * one-dark's own `stone` is the natural pick but reaches only 3.86:1 against the editor
 * background — fine for punctuation that is *meant* to recede, too low for whole
 * sentences. This is `stone` with its hue kept and luminance lifted to 5.13:1 (clears
 * WCAG AA for body text), so quotes read as secondary without becoming a squint test.
 */
const MUTED_FG = '#939db0';

/**
 * Markdown-specific tag styles, layered over one-dark's.
 *
 * ORDER IS SIGNIFICANT, in two different ways:
 *
 * 1. A node carries *several* tags at once — `**` is [strong, processingInstruction], `#` is
 *    [heading1, processingInstruction], a URL is [link, url] — and every matching tag
 *    contributes its class to the span, so the rule emitted LATER wins on CSS precedence.
 *    `processingInstruction` therefore comes last: it must dim the markers of every
 *    construct above it. `url` likewise comes after `link`.
 * 2. Within a single HighlightStyle a repeated tag *replaces* the earlier entry outright
 *    (`tagHighlighter` keeps one class per tag id). That is what lets these specs override
 *    one-dark's heading/strong/emphasis/link/url/processingInstruction rules while leaving
 *    its code-token rules — still needed for HTML embedded in Markdown — untouched.
 *
 * `tags.list` is deliberately absent: it spans the whole list *body*, not just the bullet
 * (`- item text` tags "item text" as [list, content]), so giving it a colour would tint every
 * list item's prose. Bullets are markers, and get dimmed via processingInstruction like the rest.
 */
const markdownSpecs = [
  // Headings: a warm-to-cool ramp. Level is already conveyed by size (editorHeadingUtil), so
  // colour is a redundant second cue that keeps the outline scannable while scrolling. h1 stays
  // one-dark's own heading colour, so the most common case looks unchanged. These override the
  // parent `heading` rule for h1-h6 only; bare `tags.heading` still reaches GFM table headers.
  { tag: tags.heading1, color: color.coral, fontWeight: 'bold' },
  { tag: tags.heading2, color: color.chalky, fontWeight: 'bold' },
  { tag: tags.heading3, color: color.sage, fontWeight: 'bold' },
  { tag: tags.heading4, color: color.cyan, fontWeight: 'bold' },
  { tag: tags.heading5, color: color.malibu, fontWeight: 'bold' },
  { tag: tags.heading6, color: color.violet, fontWeight: 'bold' },

  // Inline emphasis: one warm hue for both, told apart by weight vs. slant.
  { tag: tags.strong, color: color.whiskey, fontWeight: 'bold' },
  { tag: tags.emphasis, color: color.whiskey, fontStyle: 'italic' },

  // De-emphasized prose. Struck text keeps the line-through as its primary signal.
  { tag: tags.strikethrough, color: MUTED_FG, textDecoration: 'line-through' },
  { tag: tags.quote, color: MUTED_FG, fontStyle: 'italic' },

  // Code. Colour only, no background: a fenced block is highlighted one span per line, so a
  // background would end each line at the last character and look ragged down the right edge.
  { tag: tags.monospace, color: color.sage },

  // Links. `url` must follow `link` — the URL node carries both tags (see note 1 above).
  { tag: tags.link, color: color.malibu },
  { tag: tags.url, color: color.cyan, textDecoration: 'underline' },

  // `---`. Our hrLinePlugin draws the rule itself with `borderBottom: currentColor`, so this
  // colour carries through to the drawn line as well as the characters.
  { tag: tags.contentSeparator, color: color.stone },

  // Markers (#, *, -, >, backticks, [ ], ~~) — last, so they recede over everything above.
  { tag: tags.processingInstruction, color: color.stone },
];

/**
 * Highlight style for Markdown documents: one-dark's specs plus the Markdown-aware rules
 * above. Built by extending `oneDarkHighlightStyle.specs` rather than registering a second
 * highlighter, because CodeMirror consults *every* registered highlighter and concatenates
 * their classes — two styles that both matched `heading` would collide, with the winner
 * decided by stylesheet mount order. Merging into one style makes precedence explicit and
 * keeps one-dark's code tokens working for Markdown-embedded HTML.
 */
export const markdownHighlightStyle = HighlightStyle.define([
  ...oneDarkHighlightStyle.specs,
  ...markdownSpecs,
]);
