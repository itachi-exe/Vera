"use client";

import { useEffect, useRef, useState } from "react";

const SRC = "/vera-hero.mp4";
const POSTER = "/vera-hero-poster.jpg";

/** Seconds of overlap between the outgoing and incoming clip. */
const FADE = 0.7;

/**
 * Full-bleed video backdrop for the hero, ported from the reference.
 *
 * Two stacked <video> elements crossfade into one another so the loop has no
 * visible cut — the reference does exactly this rather than relying on the
 * `loop` attribute, because the clip does not butt-join cleanly.
 *
 * Desktop only. On narrower viewports this renders nothing at all, so phones
 * never download the file and keep the gradient plate underneath.
 */
export default function HeroVideo() {
  const [on, setOn] = useState(false);
  const aRef = useRef(null);
  const bRef = useRef(null);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => setOn(wide.matches && !still.matches);
    sync();

    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => {
      wide.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let cur = a;
    let nxt = b;
    let swapping = false;
    let stopped = false;

    const start = (el) => {
      try {
        el.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
      // Autoplay is only permitted muted; ignore rejection rather than throw.
      el.play().catch(() => {});
    };

    cur.style.opacity = "1";
    nxt.style.opacity = "0";
    start(cur);

    const tick = () => {
      if (stopped || swapping) return;
      const d = cur.duration;
      if (!d || Number.isNaN(d)) return;
      if (d - cur.currentTime > FADE) return;

      swapping = true;
      start(nxt);
      nxt.style.opacity = "1";
      cur.style.opacity = "0";

      window.setTimeout(() => {
        if (stopped) return;
        cur.pause();
        const prev = cur;
        cur = nxt;
        nxt = prev;
        swapping = false;
      }, FADE * 1000);
    };

    const id = window.setInterval(tick, 100);

    // Browsers pause background tabs; resume the visible clip on return.
    const onVis = () => {
      if (!document.hidden && !stopped) cur.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      a.pause();
      b.pause();
    };
  }, [on]);

  if (!on) return null;

  return (
    <div className="video-frame" aria-hidden="true">
      <video ref={aRef} className="video-el" muted playsInline preload="auto" poster={POSTER}>
        <source src={SRC} type="video/mp4" />
      </video>
      <video ref={bRef} className="video-el" muted playsInline preload="auto">
        <source src={SRC} type="video/mp4" />
      </video>
      <div className="video-overlay" />
    </div>
  );
}
