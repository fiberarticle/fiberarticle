import { Wordmark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Wordmark />
        <ThemeToggle />
      </header>
      <div className="flex flex-1 items-center justify-center px-4 pb-20">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
