import { useState, useCallback, useEffect, useRef } from 'react';
import type { AIModelConfig } from '../../types/shared';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'LLAMACPP'] as const;

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
  const [inputPer1MText, setInputPer1MText] = useState(
    initialModel ? String(initialModel.inputPer1M ?? 0) : '0'
  );
  const [outputPer1MText, setOutputPer1MText] = useState(
    initialModel ? String(initialModel.outputPer1M ?? 0) : '0'
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const isReadonly = Boolean(initialModel?.readonly);

  // Auto-focus the name field on mount
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const parseNonNegative = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  };

  const inputPer1M = parseNonNegative(inputPer1MText);
  const outputPer1M = parseNonNegative(outputPer1MText);

  const isValid =
    name.trim().length > 0 &&
    model.trim().length > 0 &&
    inputPer1M !== null &&
    outputPer1M !== null;

  const handleSave = useCallback(() => {
    if (!isValid || isReadonly) return;
    // isValid guarantees these are non-null.
    onSave({
      name: name.trim(),
      provider,
      model: model.trim(),
      inputPer1M: inputPer1M as number,
      outputPer1M: outputPer1M as number,
      vision: initialModel?.vision ?? false,
      readonly: false,
    });
  }, [isValid, isReadonly, name, provider, model, inputPer1M, outputPer1M, onSave]);

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
      className={DLG_OVERLAY_CLASS}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 w-full max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title={title} onClose={onCancel} />
        <div className="p-6">
        {isReadonly && (
          <p className="text-sm text-slate-300 mb-4">
            This is a built-in model and can’t be edited.
          </p>
        )}

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
              disabled={isReadonly}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          {/* Provider dropdown */}
          <div>
            <label className="block text-slate-300 text-sm mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIModelConfig['provider'])}
              disabled={isReadonly}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer text-sm disabled:opacity-60 disabled:cursor-not-allowed"
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
              disabled={isReadonly}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          {/* Pricing fields */}
          <div>
            <label className="block text-slate-300 text-sm mb-1">Input $/1M tokens</label>
            <input
              type="number"
              step="any"
              min={0}
              value={inputPer1MText}
              onChange={(e) => setInputPer1MText(e.target.value)}
              disabled={isReadonly}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm mb-1">Output $/1M tokens</label>
            <input
              type="number"
              step="any"
              min={0}
              value={outputPer1MText}
              onChange={(e) => setOutputPer1MText(e.target.value)}
              disabled={isReadonly}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Button bar */}
        <div className={`${DLG_FOOTER_CLASS} mt-6`}>
          <button
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || isReadonly}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default EditAIModelDialog;
