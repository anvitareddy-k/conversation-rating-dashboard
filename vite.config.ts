import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { packData } from "./scripts/pack-data.mjs";

const repoName = "conversation-rating-dashboard";

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

function compactDataPlugin(): Plugin {
  return {
    name: "compact-data",
    buildStart() {
      packData(process.cwd());
      writeDataManifest(join(process.cwd(), "public", "data"));
    },
    configureServer(server) {
      const dataDir = join(process.cwd(), "public", "data");
      packData(process.cwd());
      writeDataManifest(dataDir);
      let timer: ReturnType<typeof setTimeout> | undefined;
      watch(dataDir, (_event, filename) => {
        if (!filename || filename === "manifest.json" || !/\.csv$/i.test(filename)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          packData(process.cwd());
          writeDataManifest(dataDir);
          server.ws.send({ type: "full-reload" });
        }, 800);
      });
    },
    closeBundle() {
      const dataOut = join(process.cwd(), "dist", "data");
      if (!existsSync(dataOut)) return;
      for (const name of readdirSync(dataOut)) {
        if (/\.(csv|html)$/i.test(name)) rmSync(join(dataOut, name));
      }
    },
  };
}

export default defineConfig({
  base: `/${repoName}/`,
  plugins: [react(), compactDataPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
