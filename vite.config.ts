import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

// Must match your GitHub repo name (Pages URL: https://<user>.github.io/<repo-name>/)
const repoName = "conversation-rating-dashboard";

/** @returns true when manifest.json was updated */
function writeDataManifest(dataDir: string): boolean {
  const manifestPath = join(dataDir, "manifest.json");
  if (!existsSync(dataDir)) {
    const content = JSON.stringify({ files: [] }, null, 2) + "\n";
    writeFileSync(manifestPath, content);
    return true;
  }
  const files = readdirSync(dataDir)
    .filter((name) => /\.(csv|html)$/i.test(name))
    .sort();
  const content = JSON.stringify({ files }, null, 2) + "\n";
  if (existsSync(manifestPath) && readFileSync(manifestPath, "utf8") === content) {
    return false;
  }
  writeFileSync(manifestPath, content);
  return true;
}

/** Regenerate manifest.json when CSV/HTML files are added or removed (not on manifest writes). */
function dataManifestPlugin(): Plugin {
  return {
    name: "data-manifest",
    buildStart() {
      writeDataManifest(join(process.cwd(), "public", "data"));
    },
    configureServer(server) {
      const dataDir = join(process.cwd(), "public", "data");
      writeDataManifest(dataDir);

      let timer: ReturnType<typeof setTimeout> | undefined;
      watch(dataDir, (_event, filename) => {
        if (!filename || filename === "manifest.json" || !/\.(csv|html)$/i.test(filename)) {
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (writeDataManifest(dataDir)) {
            server.ws.send({ type: "full-reload" });
          }
        }, 300);
      });
    },
  };
}

export default defineConfig({
  base: `/${repoName}/`,
  plugins: [react(), dataManifestPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
