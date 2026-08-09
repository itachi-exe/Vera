import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import "./sections.css";

// Variable fonts: omit `weight` so the whole wght range is available.
// The reference uses Fraunces 500 (italic accents) and 600 (display).
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ui",
});

const TITLE = "Vera — Borrow against who you are";
const DESCRIPTION =
  "Vera is a trust-based lending protocol. Verified identity and on-chain compliance set your borrowing power, not just your collateral.";

/*
 * Absolute base for og:image and og:url, which social scrapers will not resolve
 * from a relative path. There is no deployed origin yet, so this reads from the
 * environment and falls back to localhost: correct in development, and correct
 * in production the moment NEXT_PUBLIC_SITE_URL is set. Hardcoding a guessed
 * production URL would be worse than the fallback, because it would look right
 * while pointing somewhere that serves nothing.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Vera",
  openGraph: {
    type: "website",
    siteName: "Vera",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
    // app/opengraph-image.jsx is picked up by file convention; naming it here
    // would override that with a second, unresolvable entry.
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport = {
  // Matches --bg, so mobile browser chrome does not frame the page in white.
  themeColor: "#0c0f0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the inline script below sets a class on <html>
    // before hydration, so server and client markup differ by design.
    <html
      lang="en"
      className={`${fraunces.variable} ${hanken.variable}`}
      // The stylesheet sets scroll-behavior: smooth. Without this attribute
      // Next.js cannot suppress it during route transitions, so navigating
      // animates the scroll instead of landing at the top of the new route.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/*
          Arms the scroll-reveal animation before first paint, so there is no
          flash of un-hidden content. The watchdog un-arms it if the React
          bundle never mounts (slow network, blocked JS, hydration error) —
          without it, a failed bundle leaves the page blank.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var d=document.documentElement;d.classList.add('js-reveal');
window.__veraRevealWatchdog=setTimeout(function(){d.classList.remove('js-reveal');},2500);
}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
