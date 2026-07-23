interface PdfViewerProps {
  /** Absolute path to the PDF file on disk. */
  path: string;
  /** Extra classes for the viewer element (defaults to a tall reading area). */
  className?: string;
}

/**
 * Standalone PDF viewer — renders a PDF using Chromium's built-in PDFium viewer
 * (zoom, page navigation, outline sidebar, search, print, download all come for
 * free). Enabled by `plugins: true` on the BrowserWindow (see src/main.ts).
 *
 * Deliberately decoupled from any Entry component: it takes a bare file path and
 * has no store/entry knowledge, so it can be reused wherever a PDF needs to be
 * shown (e.g. a future "view exported PDF" feature) without going through
 * PDFEntry.
 *
 * The file is served over the existing `local-file://` protocol (registered in
 * src/main.ts, `bypassCSP`) — the same mechanism ImageEntry uses for image src.
 * The absolute path becomes `local-file:///abs/path.pdf`.
 */
function PdfViewer({ path, className = 'w-full h-[calc(100vh-11rem)]' }: PdfViewerProps) {
  const url = `local-file://${path}`;
  return (
    <embed
      src={url}
      type="application/pdf"
      className={`rounded-lg bg-slate-900 ${className}`}
      data-testid="pdf-viewer"
    />
  );
}

export default PdfViewer;
