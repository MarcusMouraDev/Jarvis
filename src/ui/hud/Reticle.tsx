"use client";

import { useEffect, useRef } from "react";

export function Reticle() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const target = { x: 0.5, y: 0.5 };
    const pos = { x: 0.5, y: 0.5 };
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      const rect = el.parentElement?.getBoundingClientRect();
      if (!rect) return;
      target.x = (e.clientX - rect.left) / rect.width;
      target.y = (e.clientY - rect.top) / rect.height;
    };

    const tick = () => {
      pos.x += (target.x - pos.x) * 0.12;
      pos.y += (target.y - pos.y) * 0.12;
      el.style.setProperty("--rx", `${pos.x * 100}%`);
      el.style.setProperty("--ry", `${pos.y * 100}%`);
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="hud-reticle" aria-hidden />;
}
