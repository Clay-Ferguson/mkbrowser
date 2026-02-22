import { useState, useCallback, useEffect, useRef } from 'react';
import type { AIModelConfig } from '../../global.d.ts';

const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'OLLAMA'] as const;

interface EditAIModelDialogProps {
  /** Pre-populated for Edit mode; undefined for Create mode */
  initialModel?: AIModelConfig;
  onSave: (model: AIModelConfig) => void;
  onCancel: () => void;
}

function EditAIModelDialog({ initialModel, onSave, onCancel }: EditAIModelDialogProps) {
  const [name, setName] = useState(initialModel?.name ?? '');
  const [provider, setProvider] = useState<AIModelConfig['provider']>(initialModel?.provider ?? 'ANTHROPIC');
  const [model, setModel] = useState(initialModel?.model ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus the name field on mount
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const isValid = name.trim().length > 0 && model.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!isValid) return;
    onSave({ name: name.trim(), provider, model: model.trim() });
  }, [isValid, name, provider, model, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && isValid) {
      e.stopPropagation();
      handleSave();
    }
  }, [onCancel, isValid, handleSave]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const title = initialModel ? 'Edit AI Model' : 'Create AI Model';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 p-6 w-full max-w-md mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-100 mb-4">{title}</h3>

        <div className="space-y-4">
          {/* Name field */}
          <div>
            <label className="block text-slate-300 text-sm mb-1">Name</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Claude Haiku"
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>

          {/* Provider dropdown */}
          <div>
            <label className="block text-slate-300 text-sm mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIModelConfig['provider'])}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer text-sm"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Model name field */}
          <div>
            <label className="block text-slate-300 text-sm mb-1">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. claude-3-haiku-20240307"
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            />
          </div>
        </div>

        {/* Button bar */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditAIModelDialog;
