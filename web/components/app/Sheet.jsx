"use client";

import { useEffect, useRef } from "react";
import { Mark } from "@/components/Logo";
import { useModalShell } from "./useModalShell";

/**
 * Bottom sheet, ported from the reference app's "build a plan" modal:
 * circular X top-left, brand chip beside it, serif headline, labelled body,
 * full-width mint CTA pinned at the bottom.
 */
export default function Sheet({ open, onClose, title, sub, children, footer }) {
  const ref = useRef(null);

  useModalShell(open, onClose);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />

      <div className="sheet" ref={ref} tabIndex={-1}>
        <div className="sheet-top">
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">✕</span>
          </button>
          <span className="sheet-brand">
            <Mark size={13} />
            Vera
          </span>
        </div>

        <div className="sheet-body">
          <h2 className="serif sheet-title">{title}</h2>
          {sub && <p className="sheet-sub">{sub}</p>}
          {children}
        </div>

        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
