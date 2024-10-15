import type { Metadata } from "next";
import { Bricolage_Grotesque, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
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
      <body className={`${bricolage.variable} ${newsreader.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
