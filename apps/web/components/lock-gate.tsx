"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { Paywall } from "@/components/paywall";

/**
 * Pages a locked account may still open. The dashboard shows what
 * Fiberarticle does (the agents and the composer), so it stays open as a
 * preview; starting anything from it brings up the unlock page instead.
 */
const PREVIEW_PATHS = new Set(["/dashboard"]);

interface LockState {
  /** True while the account does not have full access. */
  locked: boolean;
  /** Bring up the unlock page over the current page. Call it wherever a
   * locked account tries to start something. */
  showUnlock: () => void;
}

const LockContext = React.createContext<LockState>({
  locked: false,
  showUnlock: () => {},
});

export function useLock(): LockState {
  return React.useContext(LockContext);
}

/**
 * Decides, in the browser, what a locked account sees for the page it is on:
 * the page itself on a preview page, and the unlock page everywhere else.
 * It has to be a client component: the app layout does not render again on
 * client navigation, so only usePathname here knows the current page.
 *
 * The page stays mounted while the unlock page is shown over a preview page,
 * so whatever they typed is still there after paying or going back. The API
 * refuses every feature call from a locked account (402) on its own, so this
 * only decides what is shown; it protects nothing.
 */
export function LockGate({
  locked,
  userName,
  children,
}: {
  locked: boolean;
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [unlockOpen, setUnlockOpen] = React.useState(false);

  // A new page starts without the unlock page on top of it.
  React.useEffect(() => setUnlockOpen(false), [pathname]);

  const value = React.useMemo<LockState>(
    () => ({ locked, showUnlock: () => setUnlockOpen(true) }),
    [locked]
  );

  const preview = locked && PREVIEW_PATHS.has(pathname);
  const showPaywall = locked && (!preview || unlockOpen);
  // Locked pages outside the preview are not mounted at all, so they never
  // ask the API for anything.
  const mountPage = !locked || preview;

  return (
    <LockContext.Provider value={value}>
      {showPaywall && (
        <Paywall
          userName={userName}
          onBack={preview ? () => setUnlockOpen(false) : undefined}
        />
      )}
      {/* The same wrapper in every state, so the page keeps its state when
          the unlock page opens and closes. "contents" gives it no box of
          its own, so it changes nothing about the page's layout. */}
      <div className={showPaywall ? "hidden" : "contents"}>
        {mountPage ? children : null}
      </div>
    </LockContext.Provider>
  );
}
