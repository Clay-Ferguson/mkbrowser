import { useEffect } from 'react';

interface ExifDialogProps {
  data: Record<string, Record<string, string>>;
  fileName: string;
  onClose: () => void;
}

/** Human-friendly group name labels */
const GROUP_LABELS: Record<string, string> = {
  exif: 'Exif',
  gps: 'GPS',
  iptc: 'IPTC',
  xmp: 'XMP',
  icc: 'ICC Color Profile',
  file: 'File Details',
  jfif: 'JFIF',
  png: 'PNG',
  pngFile: 'PNG File',
  pngText: 'PNG Text',
  riff: 'WebP (RIFF)',
  gif: 'GIF',
  mpf: 'Multi-Picture Format',
  photoshop: 'Photoshop',
};

function ExifDialog({ data, fileName, onClose }: ExifDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleContentClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Deduplicate: collect all tag name+value pairs seen so far, skip duplicates across groups
  const seen = new Set<string>();
  const deduped: Array<[string, Record<string, string>]> = [];
  for (const [groupName, tags] of Object.entries(data)) {
    const filtered: Record<string, string> = {};
    for (const [tagName, value] of Object.entries(tags)) {
      const key = `${tagName}\0${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        filtered[tagName] = value;
      }
    }
    if (Object.keys(filtered).length > 0) {
      deduped.push([groupName, filtered]);
    }
  }
  const isEmpty = deduped.length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleBackdropClick}>
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 p-6 max-w-5xl w-full mx-4 shadow-xl font-mono" onClick={handleContentClick}>
        <h2 className="text-slate-100 text-lg font-semibold mb-4">EXIF — {fileName}</h2>

        {isEmpty ? (
          <p className="text-slate-400 mb-6">No EXIF metadata found in this image.</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto pr-2 space-y-4 mb-6">
            {deduped.map(([groupName, tags]) => (
              <div key={groupName}>
                <h3 className="text-slate-300 text-sm font-semibold uppercase tracking-wider border-b border-slate-600 pb-1 mb-2">
                  {GROUP_LABELS[groupName] ?? groupName}
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(tags).map(([tagName, value]) => (
                      <tr key={tagName} className="border-b border-slate-700/50">
                        <td className="text-slate-400 py-1 pr-4 whitespace-nowrap align-top w-1/4">{tagName}</td>
                        <td className="text-slate-200 py-1">
                          {value.includes('\n') ? (
                            <pre className="whitespace-pre-wrap break-all m-0 font-mono text-sm">{value}</pre>
                          ) : (
                            <span className="break-all">{value}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExifDialog;
