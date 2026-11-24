import type { Metadata } from "next";
import { Bricolage_Grotesque, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Theme } from "@radix-ui/themes";
import { FONT_INIT_SCRIPT } from "@/lib/font-pref";
import "./globals.css";

// Bricolage is the optional interface font now (Google Sans is the default),
// so it is not preloaded: the browser fetches it only for people who pick it.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  preload: false,
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
    // The font variables sit on <html>, not <body>: --font-sans and
    // --font-serif are built on :root, and a variable that only exists on
    // <body> left both stacks empty there, so the app fell back to the
    // system font.
    <html
      lang="en"
      className={`${bricolage.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved interface font before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_INIT_SCRIPT }} />
        <link
          rel="preload"
          href="/fonts/google-sans/GoogleSans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
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
        <body>
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
