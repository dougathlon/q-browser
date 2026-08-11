import { defineConfig } from "vite";

function normalizeBasePath(value: string | undefined): string {
  const candidate = value?.trim() || "/";
  if (candidate === "/") return candidate;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    throw new Error("VITE_BASE_PATH must be a URL path, not an absolute URL.");
  }
  return `/${candidate.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  server: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
  },
});
