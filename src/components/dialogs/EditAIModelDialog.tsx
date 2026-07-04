import { useState } from 'react';
import { AI_PROVIDERS } from '../../shared/shared';
import type { AIModelConfig, AIProvider } from '../../shared/shared';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_FOOTER_CLASS, DLG_INPUT_CLASS_ALT } from '../../renderer/styles';

const isAIProvider = (value: string): value is AIProvider =>
  (AI_PROVIDERS as readonly string[]).includes(value);

interface EditAIModelDialogProps {
  /** Pre-populated for Edit mode; undefined for Create mode */
  initialModel?: AIModelConfig;
  onSave: (model: AIModelConfig) => void;
  onCancel: () => void;
}

/**
 * Create/edit form for a single AI model configuration (name, provider, model id,
 * and input/output per-1M-token pricing). Passing `initialModel` switches it to
 * Edit mode and seeds the fields. Built-in models (`readonly`) are shown for
 * reference but every control is disabled and Save is blocked. The price fields
 * are held as raw strings and validated via `parseNonNegative`, so Save stays
 * disabled until the name, model id, and both prices are valid.
 */
function EditAIModelDialog({ initialModel, onSave, onCancel }: EditAIModelDialogProps) {
  const [name, setName] = useState(initialModel?.name ?? '');
  const [provider, setProvider] = useState<AIProvider>(initialModel?.provider ?? 'ANTHROPIC');
  const [model, setModel] = useState(initialModel?.model ?? '');
  const [inputPer1MText, setInputPer1MText] = useState(
    initialModel ? String(initialModel.inputPer1M ?? 0) : '0'
  );
  const [outputPer1MText, setOutputPer1MText] = useState(
    initialModel ? String(initialModel.outputPer1M ?? 0) : '0'
  );
  const isReadonly = Boolean(initialModel?.readonly);

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

  const handleSave = () => {
    if (isReadonly) return;
    const trimmedName = name.trim();
    const trimmedModel = model.trim();
    // Re-parse here so the non-null prices are proven by control flow rather than
    // asserted; bail if anything is still invalid.
    const input = parseNonNegative(inputPer1MText);
    const output = parseNonNegative(outputPer1MText);
    if (trimmedName.length === 0 || trimmedModel.length === 0 || input === null || output === null) {
      return;
    }
    onSave({
      name: trimmedName,
      provider,
      model: trimmedModel,
      inputPer1M: input,
      outputPer1M: output,
      vision: initialModel?.vision ?? false,
      readonly: false,
    });
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    handleSave();
  };

  const title = initialModel ? 'Edit AI Model' : 'Create AI Model';

  return (
    <Dialog title={title} onClose={onCancel} className="w-full max-w-md">
      <form className="p-6" onSubmit={handleSubmit}>
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
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Claude Haiku"
              disabled={isReadonly}
              className={DLG_INPUT_CLASS_ALT}
              data-testid="ai-model-name-input"
            />
          </div>

          {/* Provider dropdown */}
          <div>
            <label className="block text-slate-300 text-sm mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => { if (isAIProvider(e.target.value)) setProvider(e.target.value); }}
              disabled={isReadonly}
              className={`${DLG_INPUT_CLASS_ALT} cursor-pointer`}
              data-testid="ai-model-provider-select"
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
              className={`${DLG_INPUT_CLASS_ALT} font-mono`}
              data-testid="ai-model-model-input"
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
              className={`${DLG_INPUT_CLASS_ALT} font-mono`}
              data-testid="ai-model-input-price-input"
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
              className={`${DLG_INPUT_CLASS_ALT} font-mono`}
              data-testid="ai-model-output-price-input"
            />
          </div>
        </div>

        {/* Button bar */}
        <div className={`${DLG_FOOTER_CLASS} mt-6`}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="ai-model-dialog-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || isReadonly}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="ai-model-dialog-save-button"
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default EditAIModelDialog;
