'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

// One dialog for every admin decision: optional text input (a note, a
// payment reference), a confirm button, and the API error shown in place.
export function ActionModal({
  title,
  children,
  field,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: React.ReactNode;
  field?: { label: string; required?: boolean; multiline?: boolean; placeholder?: string; hint?: string };
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (field?.required && !value.trim()) {
      setError(`${field.label} is required.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="action-modal-title" onSubmit={submit}>
        <h2 id="action-modal-title">{title}</h2>
        {children}
        {field && (
          <div className="field">
            <label htmlFor="action-modal-input">
              {field.label}
              {!field.required && <span className="faint"> (optional)</span>}
            </label>
            {field.multiline ? (
              <textarea id="action-modal-input" ref={inputRef} value={value} placeholder={field.placeholder} onChange={(e) => setValue(e.target.value)} maxLength={1000} />
            ) : (
              <input id="action-modal-input" ref={inputRef} value={value} placeholder={field.placeholder} onChange={(e) => setValue(e.target.value)} maxLength={200} />
            )}
            {field.hint && <span className="hint">{field.hint}</span>}
          </div>
        )}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={danger ? 'btn btn-danger' : 'btn'} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
