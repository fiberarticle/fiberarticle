import type { Metadata } from "next";
import { Bricolage_Grotesque, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Theme } from "@radix-ui/themes";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: {
    default: "Fiberarticle",
    template: "%s | Fiberarticle",
  },
  description:
    "Fiberarticle is an agentic AI that discovers academic sources, reads and synthesizes the literature, tracks references, and writes publication-ready articles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Radix Themes root sits on <body> itself (asChild), so dialogs and
          sheets portalled into body still get the Radix tokens. Appearance
          is left to inherit the next-themes .dark class on <html>. */}
      <Theme
        asChild
        accentColor="brown"
        grayColor="sand"
        radius="large"
        hasBackground={false}
      >
        <body
          className={`${bricolage.variable} ${newsreader.variable}`}
        >
          {/* Light for everyone until they pick another theme in the sidebar
              toggle. "System" stays available there as a choice. */}
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
            {children}
          </ThemeProvider>
        </body>
      </Theme>
    </html>
  );
}
