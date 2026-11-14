"use client";

import { useEffect, useRef } from "react";

const LOGO = "/Fiberarticle_Logo_Without_Background.svg";

/**
 * The logo redrawn as a halftone, the same drawing as the closing section of
 * the fiberarticle.com home page: the logo is shrunk onto a coarse grid and
 * each grid cell becomes a dot in that cell's colour, bigger where the logo
 * is darker. Redrawn whenever the canvas changes size.
 */
function drawHalftone(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  const step = Math.max(5, Math.round(w / 70));

  const off = document.createElement("canvas");
  off.width = Math.ceil(w / step);
  off.height = Math.ceil(h / step);
  const o = off.getContext("2d");
  if (!o) return;
  const pad = off.width * 0.08;
  o.drawImage(img, pad, pad, off.width - pad * 2, off.height - pad * 2);
  const data = o.getImageData(0, 0, off.width, off.height).data;

  for (let j = 0; j < off.height; j++) {
    for (let i = 0; i < off.width; i++) {
      const k = (j * off.width + i) * 4;
      const alpha = data[k + 3] / 255;
      if (alpha < 0.05) continue;
      const lum =
        (data[k] * 0.3 + data[k + 1] * 0.59 + data[k + 2] * 0.11) / 255;
      const r = step * 0.5 * Math.min(1, alpha * (0.55 + 0.6 * (1 - lum)));
      ctx.fillStyle = `rgb(${data[k]},${data[k + 1]},${data[k + 2]})`;
      ctx.beginPath();
      ctx.arc(i * step + step / 2, j * step + step / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function HalftoneLogo({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let img: HTMLImageElement | null = null;
    const draw = () => {
      if (img) drawHalftone(canvas, img);
    };
    const logo = new Image();
    // The SVG has no intrinsic pixel size of its own; give it one so it
    // rasterises crisply onto the small grid.
    logo.width = 512;
    logo.height = 512;
    logo.onload = () => {
      img = logo;
      draw();
    };
    logo.src = LOGO;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
