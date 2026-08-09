"use client";

import { useEffect } from "react";

/** Parts of the app that sit behind a modal and must not stay reachable. */
const SHELL = [".app-bar", ".screen", ".tabbar"];

/**
 * Shared modal behaviour for the sheets and the FAB menu.
 *
 * Both are marked `aria-modal="true"`, but neither was actually modal: the
 * FAB menu ignored Escape entirely, and in both cases the 13 controls behind
 * the overlay stayed in the tab order, so keyboard and screen-reader users
 * could wander into the page underneath. `inert` removes that subtree from
 * focus, hit-testing and the accessibility tree in one go.
 */
export function useModalShell(open, onClose) {
  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const behind = SHELL.map((s) => document.querySelector(s)).filter(Boolean);
    behind.forEach((el) => el.setAttribute("inert", ""));

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      behind.forEach((el) => el.removeAttribute("inert"));
    };
  }, [open, onClose]);
}
