import { useEffect, useRef, type ReactNode } from 'react';

/** Accessible confirmation dialog: focus-trapped, Escape to cancel, labelled for
 *  screen readers. Used before every write action. */
export function ConfirmDialog({
  open, title, children, confirmLabel = 'Confirm', tone = 'default',
  onConfirm, onCancel, confirmDisabled,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title"
        ref={ref} onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="dlg-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button
            ref={confirmRef}
            className={tone === 'danger' ? 'danger-btn' : ''}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
