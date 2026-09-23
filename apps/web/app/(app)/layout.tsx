import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFullAccess } from "@/lib/access";
import { AccessWatcher } from "@/components/access-watcher";
import { LockGate } from "@/components/lock-gate";
import { Sidebar } from "@/components/sidebar";
import { SettingsDialog } from "@/components/settings-dialog";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/sign-in");
  }

  const user = session.user as { role?: string; access?: string };
  const isAdmin = user.role === "admin";
  // Every feature is paid. A locked account sees the unlock page in place of
  // every page except the dashboard, which stays open as a preview (see
  // LockGate), and the API refuses feature calls from it as well. Settings
  // (account, export, delete) stays open to everyone.
  const locked = !hasFullAccess(user);

  return (
    // Inset shell: the sidebar sits flat on the window background and the
    // content floats as a raised panel with one big top-left corner. On
    // phones the sidebar becomes a top bar plus slide-in drawer (inside
    // Sidebar) and the panel spans the full width below the bar.
    <div className="flex h-svh bg-sidebar">
      {/* Suspense: the sidebar and settings dialog read useSearchParams for
          deep links (assistant chats, extraction tables, ?settings=<tab>). */}
      <Suspense>
        <Sidebar
          userName={session.user.name}
          userEmail={session.user.email}
          isAdmin={isAdmin}
          locked={locked}
        />
      </Suspense>
      <Suspense>
        <SettingsDialog
          userName={session.user.name}
          userEmail={session.user.email}
          emailVerified={session.user.emailVerified}
        />
      </Suspense>
      {!locked && <AccessWatcher />}
      {/* No max-width here: every page centers itself, and pages with a
          side panel (run report) need the full panel width to share. */}
      <main className="mt-14 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-t-[28px] border-t border-border bg-background shadow-[-6px_0_24px_rgba(0,0,0,0.05)] md:mt-0 md:rounded-t-none md:rounded-tl-[44px] md:border-l">
        <div className="px-4 py-6 sm:px-6 sm:py-8">
          <LockGate locked={locked} userName={session.user.name}>
            {children}
          </LockGate>
        </div>
      </main>
    </div>
  );
}
