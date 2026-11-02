import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';

import { useI18n } from '@/lib/i18n/I18nProvider';

import { Markdown } from './Markdown';

export type EditorProps = {
  label: string;
  value: string;
  multiline?: boolean;
  previewable?: boolean;
  pending?: boolean;
  disabled?: boolean;
  /** Write or validation failure; the draft stays editable. */
  error?: string | null;
  /** Reports whether the local draft differs from the stored value. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Opens a link from the preview; defaults to the system browser. */
  onOpenLink?: (url: string) => void;
  onSave: (value: string) => Promise<boolean> | boolean;
  onCancel: () => void;
};

/**
 * One explicit save/cancel editor. It owns the draft and never writes to the
 * store; the parent keeps it mounted until the write succeeds so a failure
 * cannot lose what the user typed.
 */
export function Editor({
  label,
  value,
  multiline = false,
  previewable = false,
  pending = false,
  disabled = false,
  error = null,
  onDirtyChange,
  onOpenLink,
  onSave,
  onCancel,
}: EditorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = pending || saving;
  // The parent's navigation guard cares about unsaved content, not about the
  // editor merely being open.
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(draft !== value);
  }, [draft, value]);
  useEffect(() => () => dirtyCallback.current?.(false), []);

  const save = () => {
    if (busy || disabled) {
      return;
    }
    setSaving(true);
    // The parent unmounts this editor on success; on failure it keeps the
    // draft and passes back the error.
    void Promise.resolve(onSave(draft)).finally(() => setSaving(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    const submit = multiline
      ? event.key === 'Enter' && (event.ctrlKey || event.metaKey)
      : event.key === 'Enter';
    if (submit) {
      event.preventDefault();
      save();
    }
  };

  return (
    <div role="group" aria-label={label} onKeyDown={onKeyDown} className="max-w-[72ch]">
      {preview ? (
        <div className="rounded-md border border-border bg-card p-3 shadow-xs">
          {draft.trim() === '' ? null : <Markdown onOpenLink={onOpenLink}>{draft}</Markdown>}
        </div>
      ) : multiline ? (
        <Textarea
          aria-label={label}
          value={draft}
          disabled={disabled || busy}
          onChange={(event) => setDraft(event.target.value)}
          rows={12}
          className="font-mono leading-relaxed"
        />
      ) : (
        <Input
          aria-label={label}
          value={draft}
          disabled={disabled || busy}
          onChange={(event) => setDraft(event.target.value)}
          className="h-control-md"
        />
      )}

      {error === null ? null : (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={disabled || busy}>
          {busy ? t('detail.edit.saving') : t('detail.edit.save')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('detail.edit.cancel')}
        </Button>
        {previewable ? (
          <Button variant="ghost" onClick={() => setPreview((current) => !current)} disabled={busy}>
            {preview ? t('detail.edit.edit') : t('detail.edit.preview')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
