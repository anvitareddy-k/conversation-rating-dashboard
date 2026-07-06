import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), "public", "data");
const manifestPath = join(dataDir, "manifest.json");

if (!existsSync(dataDir)) {
  writeFileSync(manifestPath, JSON.stringify({ files: [] }, null, 2) + "\n");
  process.exit(0);
}

const files = readdirSync(dataDir)
  .filter((name) => /\.(csv|html)$/i.test(name))
  .sort();

writeFileSync(manifestPath, JSON.stringify({ files }, null, 2) + "\n");
console.log(`Wrote ${manifestPath} with ${files.length} file(s).`);
