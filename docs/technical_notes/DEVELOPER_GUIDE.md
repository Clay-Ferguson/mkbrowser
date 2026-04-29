# MkBrowser is an Electron App

<!-- TOC -->

In Electron, your app runs in **two separate processes** that can't directly call each other's code:

1. **Main process** (`main.ts`) — runs Node.js, has full OS access (file system, native dialogs, menus, etc.)
2. **Renderer process** (`App.tsx`) — runs in a Chromium browser window, no Node.js access (for security)

**IPC (Inter-Process Communication)** is the message-passing bridge between them. It works like a client-server HTTP API, but over Electron's internal channel instead of a network:

| Concept | Web analogy | Electron equivalent |
|---------|-------------|---------------------|
| Define an endpoint | `app.get('/api/files', handler)` | `ipcMain.handle('read-file', handler)` |
| Call the endpoint | `fetch('/api/files')` | `ipcRenderer.invoke('read-file', path)` |
| Return data | `res.json(data)` | `return data` from the handler |

The `ipcMain.handle(channel, handler)` pattern you see ~40 times in your `main.ts` is the **request/response** pattern — the renderer `await`s a result. There's also a **push** pattern (`webContents.send` / `ipcRenderer.on`) used for events like the streaming AI chunks.

The **preload script** (`preload.ts`) sits in between as a security boundary. It selectively exposes specific IPC calls to the renderer via `contextBridge.exposeInMainWorld`, so the renderer only sees `window.electronAPI.readFile(path)` — never raw `ipcRenderer` access. That's why your AGENTS.md describes the "three-file sync" requirement: every new capability needs a handler in `main.ts`, a bridge method in `preload.ts`, and a type in `global.d.ts`.

For your refactoring: each `ipcMain.handle(...)` is essentially an independent route handler. You can freely extract them into separate modules (e.g., `ipc/fileHandlers.ts`, `ipc/aiHandlers.ts`) and just import + register them in `main.ts`, the same way you'd split a monolithic Express `app.js` into route files.
