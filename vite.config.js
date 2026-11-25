import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Emits precache.json so the service worker can cache the whole app shell on first load.
function precacheManifest() {
  return {
    name: "precache-manifest",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith(".map"));
      this.emitFile({
        type: "asset",
        fileName: "precache.json",
        source: JSON.stringify(["./", "./index.html", "./manifest.webmanifest", "./logo.svg", ...files.map(f => "./" + f)])
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  // Relative base works for GitHub Pages project sites (https://user.github.io/repo/) and for root hosting.
  base: "./"
});
