"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useEffect, useState } from "react";

/** Decorative auth-panel animation. Loaded eagerly with the page bundle
 * (no lazy import) so it starts the moment the page is interactive.
 * Unmounted for users who prefer reduced motion: pure decoration, so
 * nothing needs to replace it. */
export function AuthLottie({ src }: { src: string }) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }, []);

  if (reduceMotion) return null;
  return <DotLottieReact src={src} loop autoplay />;
}
