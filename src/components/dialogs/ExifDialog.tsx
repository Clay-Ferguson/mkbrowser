import { useState, useRef } from 'react';
import { logger } from '../../utils/logUtil';
import Dialog from './common/Dialog';
import AlertDialog from './AlertDialog';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_GREEN, DLG_FOOTER_CLASS } from '../../utils/styles';

interface ExifDialogProps {
  data: Record<string, Record<string, string>>;
  fileName: string;
  filePath: string;
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

function ExifDialog({ data, fileName, filePath, onClose }: ExifDialogProps) {
  // Current display data (starts with prop, updates after save)
  const [displayData, setDisplayData] = useState(data);
  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  // Local editable copy of EXIF data
  const [editData, setEditData] = useState<Record<string, Record<string, string>> | null>(null);
  // Track if saving (future use)
  const [saving, setSaving] = useState(false);
  // Message shown in a stacked in-app alert (replaces native alert())
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  // For auto-resize textareas
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Deduplicate: collect all tag names seen so far, skip duplicates across groups
  // Only deduplicate by tag name, not value, so editing doesn't create duplicates
  const seen = new Set<string>();
  const deduped: Array<[string, Record<string, string>]> = [];
  const source = editMode && editData ? editData : displayData;
  for (const [groupName, tags] of Object.entries(source)) {
    const filtered: Record<string, string> = {};
    for (const [tagName, value] of Object.entries(tags)) {
      if (!seen.has(tagName)) {
        seen.add(tagName);
        filtered[tagName] = value;
      }
    }
    if (Object.keys(filtered).length > 0) {
      deduped.push([groupName, filtered]);
    }
  }
  const isEmpty = deduped.length === 0;

  // Enter edit mode: make a deep copy of displayData
  const handleEdit = () => {
    // Deep copy
    const copy: Record<string, Record<string, string>> = {};
    for (const [group, tags] of Object.entries(displayData)) {
      copy[group] = { ...tags };
    }
    setEditData(copy);
    setEditMode(true);
  };

  // Cancel edit mode
  const handleCancel = () => {
    setEditMode(false);
    setEditData(null);
  };

  // Add Description field based on file type
  const handleAddDescription = () => {
    if (!editData) return;

    // Determine the appropriate group and tag based on file extension
    // This matches what the OCR script uses (see merlin_ocr.py EMBED_TAG_MAP)
    const ext = filePath.toLowerCase().split('.').pop();
    let group: string;
    let tag: string;

    if (ext === 'png') {
      group = 'png';
      tag = 'Description';
    } else if (ext === 'jpg' || ext === 'jpeg') {
      group = 'xmp-dc';  // XMP Dublin Core namespace
      tag = 'Description';
    } else {
      setAlertMessage('Description field is only supported for PNG and JPEG files.');
      return;
    }

    // Check if description already exists in any group (check common locations)
    const existingDesc = editData[group]?.[tag] || editData['png']?.['Description'] || editData['xmp-dc']?.['Description'];
    if (existingDesc !== undefined) {
      setAlertMessage('Description field already exists.');
      return;
    }

    // Add the description field with empty value
    setEditData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        [group]: {
          ...prev[group],
          [tag]: '',
        },
      };
    });
  };

  // Save handler
  const handleSave = async () => {
    if (!editData) return;

    setSaving(true);
    try {
      const ok = await window.electronAPI.writeExif(filePath, editData);
      if (!ok) {
        setAlertMessage('Failed to save EXIF data.');
        setSaving(false);
        return;
      }
      // Reload the EXIF data from the file to show the updated values
      const freshData = await window.electronAPI.readExif(filePath);
      setDisplayData(freshData);
    } catch (err) {
      logger.error('[ExifDialog] Error saving EXIF data:', err);
      setAlertMessage('Error saving EXIF data.');
    }
    setSaving(false);
    setEditMode(false);
    setEditData(null);
  };

  // Handle textarea change
  const handleFieldChange = (group: string, tag: string, value: string) => {
    if (!editData) return;
    setEditData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        [group]: {
          ...prev[group],
          [tag]: value,
        },
      };
    });
  };

  // Auto-resize textarea on input
  const handleTextareaInput = (group: string, tag: string) => {
    const key = `${group}\0${tag}`;
    const ref = textAreaRefs.current[key];
    if (ref) {
      ref.style.height = 'auto';
      ref.style.height = ref.scrollHeight + 'px';
    }
  };
  return (
    <>
    <Dialog
      title={`EXIF — ${fileName}`}
      onClose={onClose}
      closeOnBackdrop
      className={`font-mono w-full min-w-[400px] ${editMode ? 'max-w-6xl' : 'max-w-5xl'}`}
    >
      <div className="p-6">
        {isEmpty ? (
          <p className="text-slate-400 mb-6">No EXIF metadata found in this image.</p>
        ) : (
          <div className={`overflow-y-auto pr-2 space-y-4 mb-6 ${editMode ? 'max-h-[80vh]' : 'max-h-[70vh]'}`}>
            {deduped.map(([groupName, tags]) => (
              <div key={groupName}>
                <h3 className="text-slate-300 text-sm font-semibold uppercase tracking-wider border-b border-slate-600 pb-1 mb-2">
                  {GROUP_LABELS[groupName] ?? groupName}
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(tags).map(([tagName, value]) => {
                      const key = `${groupName}\0${tagName}`;
                      return (
                        <tr key={tagName} className="border-b border-slate-700/50">
                          <td className="text-slate-400 py-1 pr-4 whitespace-nowrap align-top w-1/4">{tagName}</td>
                          <td className="text-slate-200 py-1">
                            {editMode ? (
                              <textarea
                                ref={el => { textAreaRefs.current[key] = el; }}
                                className="w-full bg-slate-900 text-slate-100 rounded p-1 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                value={value}
                                rows={1}
                                style={{ minHeight: 28, maxHeight: 300, overflow: 'auto' }}
                                onChange={e => handleFieldChange(groupName, tagName, e.target.value)}
                                onInput={() => handleTextareaInput(groupName, tagName)}
                                spellCheck={false}
                              />
                            ) : value.includes('\n') ? (
                              <pre className="whitespace-pre-wrap break-all m-0 font-mono text-sm">{value}</pre>
                            ) : (
                              <span className="break-all">{value}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <div className={DLG_FOOTER_CLASS}>
          {!editMode && (
            <>
              <button
                type="button"
                onClick={handleEdit}
                className={BUTTON_CLASS_DLG_GREEN}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onClose}
                className={BUTTON_CLASS_DLG_BLUE}
              >
                Close
              </button>
            </>
          )}
          {editMode && (
            <>
              <button
                type="button"
                onClick={handleAddDescription}
                className="px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-500 rounded transition-colors mr-auto"
                title="Add description field for storing text"
              >
                Add Description
              </button>
              <button
                type="button"
                onClick={handleSave}
                className={BUTTON_CLASS_DLG_BLUE}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-white bg-slate-600 hover:bg-slate-500 rounded transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
    {alertMessage && (
      <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} />
    )}
    </>
  );
}

export default ExifDialog;
