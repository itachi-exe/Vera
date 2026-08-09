import AppClient from "@/components/app/AppClient";
import "./app.css";

const TITLE = "Vera — Dashboard";
const DESCRIPTION = "Your trust score, borrowing power, and open credit line.";

// The generated card lives at app/opengraph-image.jsx and is shared by both
// routes. Naming it explicitly is necessary here: setting `openGraph` below
// replaces the parent's resolved object wholesale rather than merging into it,
// so without this line /app would advertise no image at all.
const OG_IMAGE = "/opengraph-image";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Restated rather than inherited for the same reason: a route that sets
  // neither block would show the landing page's title on its own card.
  openGraph: {
    type: "website",
    siteName: "Vera",
    title: TITLE,
    description: DESCRIPTION,
    url: "/app",
    images: [{ url: OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function AppPage() {
  return <AppClient />;
}
