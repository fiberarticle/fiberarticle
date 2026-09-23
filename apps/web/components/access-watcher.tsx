"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ACCESS_LOST_EVENT } from "@/lib/api";

/**
 * Brings up the unlock page if access is taken away mid-session.
 *
 * The app layout decides between the features and the unlock page on the
 * server, and a layout is not rendered again on client-side navigation. So
 * an account that loses access while a page is open (an admin removes it, or
 * a payment is refunded) would keep the features on screen, with every call
 * failing. apiFetch announces the API's 402 answer; this refreshes the page
 * so the layout runs again and shows the unlock page.
 */
export function AccessWatcher() {
  const router = useRouter();

  React.useEffect(() => {
    let refreshed = false;
    const onLost = () => {
      if (refreshed) return;
      refreshed = true;
      router.refresh();
    };
    window.addEventListener(ACCESS_LOST_EVENT, onLost);
    return () => window.removeEventListener(ACCESS_LOST_EVENT, onLost);
  }, [router]);

  return null;
}
