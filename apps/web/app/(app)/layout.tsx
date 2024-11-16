import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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

  return (
    // Inset shell: the sidebar sits flat on the window background and the
    // content floats as a raised panel with one big top-left corner. On
    // phones the sidebar becomes a top bar plus slide-in drawer (inside
    // Sidebar) and the panel spans the full width below the bar.
    <div className="flex h-svh bg-sidebar">
      {/* Suspense: the sidebar and settings dialog read useSearchParams for
          deep links (assistant chats, extraction tables, ?settings=<tab>). */}
      <Suspense>
        <Sidebar userName={session.user.name} userEmail={session.user.email} />
      </Suspense>
      <Suspense>
        <SettingsDialog
          userName={session.user.name}
          userEmail={session.user.email}
          emailVerified={session.user.emailVerified}
        />
      </Suspense>
      {/* No max-width here: every page centers itself, and pages with a
          side panel (run report) need the full panel width to share. */}
      <main className="mt-14 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-t-[28px] border-t border-border bg-background shadow-[-6px_0_24px_rgba(0,0,0,0.05)] md:mt-0 md:rounded-t-none md:rounded-tl-[44px] md:border-l">
        <div className="px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
