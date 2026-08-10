import DocClient from "@/components/doc/DocClient";
import "./doc.css";

const TITLE = "Vera — Documentation";
const DESCRIPTION =
  "How Vera works, how the trust score is computed, what runs where, and what is real about this build.";

// Shared card, named explicitly for the reason app/app/page.js states: setting
// `openGraph` below replaces the parent's resolved object rather than merging
// into it, so without this the doc page would advertise no image at all.
const OG_IMAGE = "/opengraph-image";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Vera",
    title: TITLE,
    description: DESCRIPTION,
    url: "/doc",
    images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function DocPage() {
  return <DocClient />;
}
