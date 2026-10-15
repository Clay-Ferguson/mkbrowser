import { CALLOUT_CSS } from '../../shared/exportMDtoHTML';

/**
 * The folder HTML export's stylesheet, embedded in a `<style>` block in every page
 * rather than linked as a shared file: viewers such as the Google Drive phone app
 * open one HTML file on its own, without its folder, so a relative stylesheet link
 * would never load. A dark slate theme close to the app's
 * `prose-invert` look. Content fills the browser width apart from a small side
 * margin. Code blocks (mermaid included) are plain monospace text: the export is
 * fully offline and does no syntax highlighting.
 */
export const STYLE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  --bg: #0f172a;
  --text: #cbd5e1;
  --heading: #f1f5f9;
  --muted: #94a3b8;
  --border: #475569;
  --border-soft: #334155;
  --surface: #1e293b;
  /* Same colors as the app's rendered Markdown (index.css btn-accent-blue/amber):
     web links light blue, links to files and folders the folder amber. */
  --link: #5d9eff;
  --link-hover: #90bcfe;
  --file-link: #fbab0b;
  --file-link-hover: #ffd295;
}

html { background: var(--bg); }

body {
  margin: 0;
  padding: 1rem 1.5rem 3rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.75;
  color: var(--text);
  background: var(--bg);
}

main { width: 100%; }

/* Breadcrumb trail at the top of each page (when index pages are generated) */
nav.breadcrumb {
  font-size: 0.85rem;
  color: var(--muted);
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-soft);
}
nav.breadcrumb .sep { margin: 0 0.4em; color: var(--border); }
nav.breadcrumb .current { color: var(--text); }

h1, h2, h3, h4, h5, h6 { color: var(--heading); font-weight: 600; line-height: 1.3; }
h1 { font-size: 1.75rem; margin: 0 0 0.6em; }
h2 { font-size: 1.4rem; margin: 1.2em 0 0.5em; }
h3 { font-size: 1.2rem; margin: 1em 0 0.4em; }
h4 { font-size: 1.1rem; margin: 0.9em 0 0.3em; }
h5, h6 { font-size: 1rem; margin: 0.8em 0 0.3em; }

p { margin: 0 0 1em; }
strong { color: var(--heading); }

a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
a:hover { color: var(--link-hover); }
a.file-link, nav.breadcrumb a, .folder-index a { color: var(--file-link); }
a.file-link:hover, nav.breadcrumb a:hover, .folder-index a:hover { color: var(--file-link-hover); }

img { max-width: 100%; height: auto; }

ul, ol { margin: 0 0 1em; padding-left: 1.75rem; }
li { margin: 0.25em 0; }
li > ul, li > ol { margin-bottom: 0; }
ul.contains-task-list { list-style: none; padding-left: 0.5rem; }
/* Generated table of contents (tagged by remarkTocList): compact rows, small bullets — as the app. */
ul.toc-list, ul.toc-list ul { margin: 0; padding-left: 1.1em; }
ul.toc-list { margin-bottom: 1em; }
ul.toc-list li { margin: 0; padding-left: 0.2em; line-height: 1.35; }
ul.toc-list li::marker { font-size: 0.7em; }

hr { border: none; border-top: 1px solid var(--muted); margin: 0.5rem 0; }

blockquote {
  margin: 1em 0;
  padding: 0.25em 1em;
  border-left: 4px solid var(--border);
  color: var(--text);
  font-style: italic;
}
blockquote.markdown-alert { font-style: normal; padding: 0.6em 1em; }

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.875em;
}
:not(pre) > code {
  color: var(--heading);
  background: var(--surface);
  border-radius: 4px;
  padding: 0.15em 0.35em;
}
pre {
  margin: 0 0 1em;
  padding: 0.8em 1em;
  overflow-x: auto;
  line-height: 1.5;
  color: #e2e8f0;
  background: #282c34;
  border: 1px solid var(--border);
  border-radius: 6px;
}

table { border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
th, td { border: 1px solid var(--border); padding: 0.4em 0.75em; text-align: left; vertical-align: top; }
th { color: var(--heading); background: var(--surface); font-weight: 600; }

/* Pages split into columns with |||, as in the app */
.columns { display: grid; gap: 1.5rem; }
.columns > .col { min-width: 0; }
.columns > .col + .col { border-left: 1px solid var(--border); padding-left: 1.5rem; }

/* Typed object cards (Types Editor), mirroring the app's ObjectBlock + GenericObject */
.object-block {
  width: fit-content;
  max-width: 100%;
  min-width: 16rem;
  margin: 0 0 1em;
  padding: 0.5rem 1rem 0.75rem;
  color: #e2e8f0;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid var(--border);
  border-radius: 6px;
  line-height: 1.5;
}
.object-type {
  margin-bottom: 0.25rem;
  text-align: right;
  font-size: 0.75rem;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #38bdf8; /* sky-400, as the app card's type caption and icon */
}
.object-title { font-size: 1.125rem; font-weight: 600; color: var(--heading); overflow-wrap: anywhere; }
.object-title.object-untitled { font-weight: normal; font-style: italic; color: var(--muted); }
/* "Collapsible Objects": the title is the <summary> of a <details> holding the rows. Sized as a
   large, muted-blue tap target (well over the ~44px touch minimum) for reading on a phone. */
summary.object-title {
  display: list-item;
  list-style-position: inside;
  min-height: 3rem;
  margin-top: 0.25rem;
  padding: 0.7rem 1rem;
  font-size: 1.2rem;
  line-height: 1.4;
  color: #e8eef6;
  background: #34557a;
  border: 1px solid #44688f;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
summary.object-title:hover { background: #3c6189; }
summary.object-title:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
summary.object-title::marker { color: #b4c6dc; }
summary.object-title.object-untitled { color: #c3d0e0; }
details[open] > summary.object-title { margin-bottom: 0.5rem; }
/* On a phone a collapsible card spans the page, so its title bar is a full-width tap target. */
@media (max-width: 640px) {
  .object-block:has(> details) { width: 100%; }
}
/* Each row is a div of bullet / name / value; display: contents lets all rows share one grid,
   so names and values line up across rows. */
.object-rows {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: start;
  gap: 0.375rem 0.5rem;
  margin-top: 0.375rem;
  font-size: 0.875rem;
}
.object-row { display: contents; }
.object-bullet { color: var(--muted); }
.object-label { white-space: nowrap; color: var(--muted); }
.object-value { min-width: 0; overflow-wrap: anywhere; white-space: pre-line; color: var(--text); }
a.object-value { color: var(--link); }
.invalid-object-hint { margin: 0 0 1em; font-size: 0.75rem; color: rgba(252, 211, 77, 0.9); }

/* Generated folder index pages (_index.html) */
.folder-index ul { list-style: none; padding-left: 0; }
.folder-index li { margin: 0.2em 0; }
.folder-index .entry-icon { display: inline-block; width: 1.6em; }
.folder-index .empty { color: var(--muted); font-style: italic; }

${CALLOUT_CSS}
`.trimStart();
