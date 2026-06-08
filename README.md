# MkBrowser

MkBrowser is an Electron desktop app that combines a file explorer with inline Markdown rendering, image rendering, and text file editing. It shows a single folder level at a time and renders `.md` files directly within the list rather than using a separate preview pane. 

This README is aimed at developers; a separate [User Guide](docs/USER_GUIDE.md) covers end-user usage. See [Testing](docs/TESTING.md) for details on the test framework and how to write tests. 

**[Demo Videos](https://clay-ferguson.github.io/videos/)**

**[Animated GIFs](docs/img/animated-gifs/about-animated-gifs.md)**

## Features

A comprehensive list of what MkBrowser can do. See the [User Guide](docs/USER_GUIDE.md) for full details on any item.

### Browsing & Viewing

| Feature | Description |
|---------|-------------|
| Inline Markdown rendering | `.md` files expand and render directly in the file list, no separate preview pane. |
| Inline image preview | Click an image to preview it inline within the list. |
| Expand All / Collapse All | Open or close every file in the current folder with one click. |
| Index Tree panel | Optional left-hand folder tree (configurable width, or hidden entirely). |
| Breadcrumb navigation | Click any path segment to jump up the folder hierarchy. |
| Recent Folders | Remembers up to 10 recently visited folders for quick return. |
| Up Level | Jump to the parent folder with the originating subfolder highlighted. |
| Tab bar | Switch between Browse, Chat, Search, Analysis, Graph, Settings, AI Settings, and Calendar views. |
| Hidden files filtered | Dotfiles are hidden by default. |
| Content caching | Markdown content is cached to reduce re-reads. |

### Editing

| Feature | Description |
|---------|-------------|
| In-place editing | Edit Markdown/text with a CodeMirror 6 editor, with save/cancel flow. |
| Multiple concurrent edits | Several files can be open for editing at once. |
| Editor keyboard shortcuts | `Ctrl+S` save & exit, `Ctrl+Q` abandon changes, `Esc` exit (when unchanged). |
| Expand Editor | Full-width, distraction-free editing surface that hides other entries. |
| Automatic Table of Contents | A `<!-- TOC -->` placeholder is regenerated from headings on every save. |
| Tag Picker | Add/remove front-matter hashtags via checkboxes while editing (Obsidian-compatible). |
| Tags Editor | Define and organize your hashtag library into categories (with radio-style and multi-select categories). |
| Insert links to files | Right-click a file in the tree → **Paste Link** to insert a relative Markdown link at the cursor. |
| Copy Link / Paste Link | Capture selected files/images anywhere and paste them as relative links (images inline) into any document. |

### File Management

| Feature | Description |
|---------|-------------|
| Multi-select | Checkbox selection for batch operations. |
| Cut / Copy / Paste / Delete | Full file operations via the Edit menu or keyboard. Contextual paste icons appear at valid destinations. |
| Undo Cut | Cancel a pending move before pasting. |
| Select All / Unselect All | Bulk selection helpers. |
| Drag and drop | Move files/folders between the tree, browse view, and breadcrumbs by dragging their icon. |
| Rename | Rename via button or double-click; associated `.attach` folders are renamed automatically. |
| Trash-safe delete | Deleted items go to the OS trash rather than being permanently removed. |
| Split | Divide a file into numbered files at each double blank line. |
| Join | Merge multiple selected files into one, separated by double blank lines. |
| Single-click create from clipboard | Create a new file from clipboard content. |
| Create file/folder at position | In Document Mode, insert bars let you create content at an exact spot. |
| Run shell scripts | `Ctrl+Click` a `.sh` file to execute it; `# Terminal=false` runs it silently. |

### Document Mode & Attachments

| Feature | Description |
|---------|-------------|
| Document Mode | Treat a folder as an ordered document (notebook-style blocks) via `.INDEX.yaml`. |
| Manual reordering | Move entries up/down (or to top/bottom with Ctrl) when editing is enabled. |
| File Attachments | Associate files with a document via a `.md.attach` companion folder, shown inline in Document Mode. |

### Organization & Navigation

| Feature | Description |
|---------|-------------|
| Bookmarks | Bookmark files/folders; navigate, rename, and delete them from the Index Tree. |
| Clickable hashtags | Any rendered `#hashtag` is a live link that runs a search for that tag. |

### Search & Analysis

| Feature | Description |
|---------|-------------|
| Full-text search | Search file content or file names. |
| Search modes | Literal, Wildcard (`*`), and Advanced (JavaScript-like predicates). |
| Advanced predicates | `$()` content match, front-matter `prop()`, date helpers `past()`/`future()`/`today()`, and `ts`. |
| Search highlighting | Matches are highlighted across all rendered content, not just the results tab. |
| Saved searches | Name and save searches; rerun them from the Search menu. |
| Replace in Files | Bulk find-and-replace across all `.md`/`.txt` files recursively. |
| Folder Analysis | Recursively count and rank all hashtags across a folder. |
| Folder Graph | Interactive physics-based node graph of a folder (or of search results); pan, zoom, drag, click-to-navigate. |
| Ignored paths | Exclude named files/folders from search, replace, analysis, and graph scans. |

### Markdown Rendering

| Feature | Description |
|---------|-------------|
| GitHub Flavored Markdown | Tables, strikethrough, task lists, autolinks. |
| LaTeX math | Inline `$...$` and block `$$...$$` equations via KaTeX, with `\$` escaping for currency. |
| Wikilinks | `[[file]]`, `[[file\|alias]]`, and `[[file#section]]` linking syntax. |
| Mermaid diagrams | Fenced ` ```mermaid ` blocks render as diagrams. |
| Syntax highlighting | Fenced code blocks render with language-aware colors. |
| Column layout | A `\|\|\|` line splits content into side-by-side columns. |

### AI Features

| Feature | Description |
|---------|-------------|
| AI Chat | Integrated chat with folder-based conversation history (`HUMAN.md`/`AI.md`, plus `THINK.md` for reasoning models). |
| Branching conversations | Conversations form an `A/H/A/H` folder tree, enabling branching, forking, and multi-agent workflows. |
| Chat Thread view | Renders a full conversation as a stacked thread with a Reply button. |
| Multiple providers | Anthropic, OpenAI, Google AI, and llama.cpp (local) models. |
| Model management | Create/edit/delete named model entries with provider, vision support, and per-token cost. |
| llama.cpp server controls | Start/stop/refresh a local llama-server from within the app. |
| Agentic Mode | Let the AI read, write, and delete files via tools, scoped to Allowed Folders. |
| `#file:` attachments | Embed matching files (text or images) into a prompt via `#file:<pattern>` directives. |
| AI Rewrite | AI-assisted rewrite of a file or a selection, shown as a reviewable diff. |
| Full Document Context | Give the rewrite AI awareness of all files in a Document-Mode folder. |
| AI Personas | Named system-prompt personas for chat and rewrite. |
| AI Usage Statistics | Track requests, tokens, and estimated cost per provider. |

### Calendar

| Feature | Description |
|---------|-------------|
| Calendar view | Scans front-matter `due` dates and shows them on a calendar. |
| Timed events | Optional `start` time and `duration` for non-all-day events. |
| Recurring events | iCal-style `rrule` (freq, interval, byday, until, count). |
| Live updates | Calendar updates in real time as watched files change. |
| Jump to file | Click an event to open its file in the Browse view. |
| New Event | Create calendar files from the Calendar view, optionally in a configured folder. |

### Images & Export

| Feature | Description |
|---------|-------------|
| EXIF viewer/editor | View and edit embedded image metadata (Exif, GPS, IPTC/XMP, and more). |
| Folder export | Export a folder's contents to a single Markdown file, with options for subfolders, filenames, and dividers. |
| PDF export | Export Markdown content to PDF. |
| Markdown-to-HTML autogen | An `autogen.outputFile` front-matter block regenerates a self-contained HTML file on every save. |
| OCR | Run OCR on a folder's images via an external tools folder (Tools → Run OCR). |

### Appearance & Settings

| Feature | Description |
|---------|-------------|
| Font size | Small / Medium / Large / Extra Large. |
| Content width | Narrow / Medium / Wide / Full Width. |
| Folder tree width | Hidden / Narrow / Medium / Wide. |
| Folders on top | Always sort folders above files. |
| Configurable sorting | Multiple sort orders for file listings. |
| Show Table of Contents | Toggle inline rendering of `<!-- TOC -->` blocks. |
| Desktop icon (Linux) | Install script to add MkBrowser to the application launcher. |

## Screenshots

### View Files Collapsed
![collapsed-files](docs/img/collapsed-files.png)

### View Files Expanded
![expanded-file](docs/img/expanded-file.png)

### Editing a File
![expanded-file](docs/img/editing-file.png)

### Searching
![expanded-file](docs/img/searching.png)

### Export
![export-dialog](docs/img/export-dialog.png)

### Settings
![settings-page](docs/img/settings-page.png)

## Tech Stack

- **Runtime**: Electron 40
- **Build tooling**: Electron Forge + Vite
- **Language**: TypeScript
- **UI**: React 19
- **Styling**: Tailwind CSS 4 + Typography plugin
- **Markdown**: `react-markdown`, `remark-math`, `rehype-katex`, KaTeX
- **Editor**: CodeMirror 6
- **Diagrams**: Mermaid
- **Config**: YAML (`js-yaml`)
- **LangChain/LangGraph**: For Local & Cloud API Access
- **Llama.cpp Configs**: Local LLMs


## Architecture Overview

MkBrowser uses Electron’s three-process architecture and follows a strict IPC boundary. Renderer code never touches the file system directly.

- **Main process**: Owns all file system operations and IPC handlers.
- **Preload**: Exposes a typed `window.electronAPI` surface to the renderer.
- **Renderer**: React UI only, calls `window.electronAPI.*` for any file operations.

Data flow:

Renderer → `window.electronAPI.*` → `ipcRenderer.invoke` → Main process handler → Node.js fs → return to renderer

## State Management

State is handled by a small store built on React’s `useSyncExternalStore` (no Redux/Context). Items are stored in a `Map<path, ItemData>` for O(1) lookups. Store updates create new objects to ensure re-renders.

Key item fields include:
- `isSelected` for multi-select UI
- `content` and `contentCachedAt` for Markdown caching
- `editing` for per-file edit mode (supports multiple concurrent edits)

## Configuration

MkBrowser stores configuration in a YAML file under the user’s config directory. It currently tracks the last browsed folder.

## Development Workflow

### Install NodeJS

See file `install-node.sh`

### Install App Dependencies

```bash
npm install
```

### Run (Linux)

Linux requires sandbox disablement:

```bash
npm run start:linux
```

### Run (Windows/Mac)

```bash
npm start
```

### Lint

```bash
npm run lint
```

### Package / Make

```bash
npm run package
npm run make
```

## Key Packages

### Runtime Dependencies

- `react`, `react-dom`
- `react-markdown`
- `remark-math`, `rehype-katex`, `katex`
- `codemirror` + `@codemirror/*`
- `mermaid`
- `fdir` (directory scanning)
- `js-yaml`
- `typo-js`

### Dev Dependencies

- `electron`, `@electron-forge/*`
- `vite`, `@vitejs/plugin-react`
- `typescript`
- `tailwindcss`, `@tailwindcss/typography`, `@tailwindcss/vite`
- `eslint` + `@typescript-eslint/*`
- `postcss`, `autoprefixer`

## Project Structure (high level)

- **Main process**: `src/main.ts`
- **Preload**: `src/preload.ts`
- **Renderer entry**: `src/renderer.tsx`
- **UI**: `src/App.tsx` and `src/components/*`
- **State**: `src/store/*`

## Contributing Notes

- All file system access must stay in the main process.
- If you add a new IPC handler, update:
  - `src/main.ts`
  - `src/preload.ts`
  - `src/global.d.ts`
- Keep renderer logic UI-only.
- Tailwind CSS is configured in `src/index.css` (CSS-first setup).

---

*WARNING: This application is only known to work on Linux (developed/test on Ubuntu only)*