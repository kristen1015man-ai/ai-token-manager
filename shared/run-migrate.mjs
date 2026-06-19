import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tmpDir = path.join(process.cwd(), ".tmp");
const outfile = path.join(tmpDir, "migrate.mjs");

fs.mkdirSync(tmpDir, { recursive: true });

await build({
  entryPoints: ["migrate.ts"],
  outfile,
  platform: "node",
  format: "esm",
  bundle: false,
  logLevel: "silent",
});

await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
