# Project Briefing: MkBrowser

## Overview

**MkBrowser** is a desktop application built with Electron. It functions as a hybrid between a file explorer and a markdown browser. Instead of a traditional side-bar tree view, it displays a single folder's contents at a time. If a file is a Markdown (`.md`) file, its content is rendered **in-line** directly within the file list, along with the other file names and folder names. The application will store some configuration information in a yaml file , in the appropriate location for a Linux Ubuntu machine . initially the only thing we will store in the ammo file will be the name of the folder that we're going to browse . when the application starts up for the first time, this folder name will of course be empty and so therefore we will prompt the user to enter a file name or select a file name using the appropriate folder selection dialog that's used in most electron apps.

## Tech Stack & Architectural Decisions

* **Framework:** Electron (Latest)
* **Scaffolding Tool:** Official **Electron Forge** (`npx create-electron-app@latest`)
* **Build Tooling:** **Vite** (via the Electron Forge Vite plugin)
* **Language:** **TypeScript**
* **Frontend Library:** **React**
* **Styling Library:** **Tailwind** (as mentioned in Step 3 below)
* **Communication:** No internal web server (no Express). All file system operations must use **Electron IPC (Inter-Process Communication)** via a Preload script.
* **Navigation Style:** Flat, single-level directory browsing (no tree component).
* **Yarn:** I prefer yarn over npm, if that's acceptable (and appropriate) for an Electron app
---

## Roadmap & Instructions for AI Agent

### Step 1: Initial Scaffolding

Initialize the project using the official Electron Forge Vite + TypeScript + React template.

1. Run `npx create-electron-app@latest mk-browser --template=vite-typescript`.
2. Ensure the React entry point is correctly wired within the `src/renderer` directory.
3. Clean up the default boilerplate UI to provide a clean slate for a directory listing.

### Step 2: Core MVP - The Markdown Browser

Implement the "Single-Level Inline Browser" logic:

1. **Main Process (Node.js):** * Create IPC handlers to:
* Read the contents of a directory (`fs.readdir`).
* Detect if a file is a Markdown file
* Read the text contents of Markdown files (`fs.readFile`).
2. **Preload Script:** * Expose a secure API (`window.electronAPI`) to allow the React frontend to request directory data.
3. **Renderer Process (React):**
* **State Management:** Track the "Current Path."
* **The List Component:** Map through the files/folders in the current path.
* **Conditional Rendering:** * If the item is a **Folder**, display a folder icon and name (clickable to "drill down").
* If the item is a **Standard File**, display the filename.
* If the item is a **Markdown File**, display the filename AND render the full Markdown content immediately below the filename.

* **Markdown Rendering:** Use a library like `react-markdown` to handle the rendering of the `.md` content.

This is a great addition. Since you're using **Tailwind CSS**, the coding agent should prioritize utility classes and the **Tailwind Typography plugin** (`@tailwindcss/typography`), which is specifically designed to make rendered Markdown look professional and "modern" with zero effort.

---

## Step 3: UI/UX & Tailwind CSS Integration

**Objective:** Create a clean, minimalist "Modern Browser" aesthetic.

### 1. Tailwind Setup

* Install Tailwind CSS, PostCSS, and Autoprefixer within the Vite environment.
* **Crucial:** Install the `@tailwindcss/typography` plugin. This is required to style the rendered Markdown content using the `prose` class.

### 2. Styling Preferences

* **Layout:** A centered, max-width container (e.g., `max-w-4xl`) to ensure the Markdown is readable and doesn't stretch too wide on large monitors.
* **The "Row" Design:**
* **Folders:** Should look like clean, interactive rows with a subtle hover effect (e.g., `hover:bg-gray-100`).
* **Markdown Files:** Instead of just a list item, render Markdown files inside a **"Card"** style container. Use a subtle border and a slightly different background (e.g., `bg-white` or `bg-slate-50`) to separate the rendered content from the rest of the file list.


* **Typography:** * Use a clean sans-serif stack for the file explorer UI (Inter or system-ui).
* Use the `prose prose-slate` classes on the Markdown container to ensure headings, lists, and code blocks are automatically styled beautifully.



### 3. Visual Cues

* **Navigation:** Include a "Breadcrumb" or a "Back" button at the top of the list so the user can navigate back up the folder hierarchy easily.
* **Empty State:** Provide a simple, clean "This folder is empty" message if `fs.readdir` returns no results.

---

### Pro-Tip for Coding Agent:

<pro_tip>
When configuring Tailwind in Electron Forge with Vite, ensure the `content` array in `tailwind.config.js` points correctly to the `./src/renderer` directory and includes `.tsx` and `.ts` files.
</pro_tip>

This is the most common place where AI agents trip up with Electron + Tailwind!

