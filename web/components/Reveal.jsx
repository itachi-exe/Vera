"use client";

import { useEffect } from "react";

/**
 * Mounts once. Observes every .reveal on the page and adds .in when it
 * enters the viewport, staggering siblings by DOM order.
 *
 * The hiding itself lives behind `html.js-reveal`, armed by an inline script
 * in layout.js. This component takes ownership of that flag on mount, so the
 * page can never be left blank by a bundle that fails to load.
 */
export default function Reveal() {
  useEffect(() => {
    const root = document.documentElement;

    // We're alive — cancel the "JS never mounted" fallback.
    clearTimeout(window.__veraRevealWatchdog);

    const nodes = Array.from(document.querySelectorAll(".reveal"));
    const showAll = () => {
      nodes.forEach((n) => n.classList.add("in"));
      root.classList.remove("js-reveal");
    };

    if (!nodes.length) {
      root.classList.remove("js-reveal");
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      showAll();
      return;
    }

    // Make sure the flag is on even if the inline script did not run.
    root.classList.add("js-reveal");

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          // Stagger within the nearest section so groups cascade.
          const group = el.closest("section") || document.body;
          const peers = Array.from(group.querySelectorAll(".reveal"));
          const i = Math.max(0, peers.indexOf(el));
          el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 70}ms`);
          el.classList.add("in");
          io.unobserve(el);
        });
      },
      // threshold 0 so elements taller than a phone viewport still trigger.
      { rootMargin: "0px 0px -5% 0px", threshold: 0 }
    );

    nodes.forEach((n) => io.observe(n));

    // Belt and braces: if anything is still hidden well after load (observer
    // quirks, restored scroll position, bfcache), just show it.
    const sweep = setTimeout(() => {
      nodes
        .filter((n) => !n.classList.contains("in"))
        .forEach((n) => {
          const r = n.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) n.classList.add("in");
        });
    }, 1200);

    const onPageShow = (e) => {
      if (e.persisted) showAll();
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      io.disconnect();
      clearTimeout(sweep);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
