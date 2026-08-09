import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    /*
     * The credentialed server tier lives in the sibling `vera-backend` package,
     * so the build has to be allowed to reach one directory up. Without this,
     * Turbopack resolves the `@vera/backend/*` alias but refuses to follow it
     * outside the project directory, and every route handler fails to build
     * with "Module not found" naming an alias it just resolved.
     */
    root: path.join(here, ".."),
  },
};

export default nextConfig;
