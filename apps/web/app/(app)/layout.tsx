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
    // content floats as a raised panel with one big top-left corner.
    <div className="flex h-screen bg-sidebar">
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
      <main className="min-w-0 flex-1 overflow-y-auto rounded-tl-[44px] border-l border-t border-border bg-background shadow-[-6px_0_24px_rgba(0,0,0,0.05)]">
        <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
