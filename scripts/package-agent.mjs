import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const agentRoot = path.join(repoRoot, "agent");
const outDir = path.join(repoRoot, "handoff-packages", "studio-agent-build");
const publicDir = path.join(repoRoot, "web", "public", "downloads", "studio-agent");
const generatedDir = path.join(repoRoot, "web", "src", "generated");
const allowSkipPublic = process.argv.includes("--allow-skip-public");
const version = JSON.parse(fs.readFileSync(path.join(agentRoot, "package.json"), "utf8")).version || "0.1.0";
const runtimeVersion = /const VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(agentRoot, "src", "index.mjs"), "utf8"))?.[1] || "";
if (runtimeVersion !== version) {
  throw new Error(`Agent runtime version ${runtimeVersion || "(missing)"} does not match package version ${version}`);
}
const fixedZipDate = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  return (hours << 11) | (minutes << 5) | seconds;
}

function dosDate(date) {
  const year = Math.max(1980, date.getUTCFullYear()) - 1980;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return (year << 9) | (month << 5) | day;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function listFiles(dir, prefix = "") {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => compareStrings(a.name, b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...listFiles(abs, rel));
    } else if (entry.isFile()) {
      result.push({ abs, rel });
    }
  }
  return result;
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function modeFor(name) {
  return name.endsWith(".sh") ? 0o100755 : 0o100644;
}

function isTextEntry(name) {
  return /\.(json|md|mjs|js|ps1|sh|cmd|bat|txt)$/i.test(name);
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const modTime = dosTime(fixedZipDate);
  const modDate = dosDate(fixedZipDate);

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(modTime),
      writeUInt16(modDate),
      writeUInt32(crc),
      writeUInt32(size),
      writeUInt32(size),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer,
    ]);

    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(0x031e),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(modTime),
      writeUInt16(modDate),
      writeUInt32(crc),
      writeUInt32(size),
      writeUInt32(size),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32((entry.mode || 0o100644) << 16),
      writeUInt32(offset),
      nameBuffer,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return Buffer.concat([...localParts, central, eocd]);
}

function readEntry(abs, rel) {
  const raw = fs.readFileSync(abs);
  return {
    name: `sparkloom-agent-${version}/${rel.replaceAll("\\", "/")}`,
    data: isTextEntry(rel) ? Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8") : raw,
    mode: modeFor(rel),
  };
}

function supportRel(rel) {
  return `support/${rel}`;
}

function buildEntries(platform) {
  const windows = platform === "windows";
  const files = [
    { abs: path.join(agentRoot, "package.json"), rel: windows ? supportRel("package.json") : "package.json" },
    { abs: path.join(agentRoot, "src", "index.mjs"), rel: windows ? supportRel("src/index.mjs") : "src/index.mjs" },
  ];
  const lockFile = path.join(agentRoot, "package-lock.json");
  if (fs.existsSync(lockFile)) {
    files.push({ abs: lockFile, rel: windows ? supportRel("package-lock.json") : "package-lock.json" });
  }
  files.push({ abs: path.join(agentRoot, "README.md"), rel: windows ? supportRel("README.md") : "README.md" });

  for (const item of listFiles(path.join(agentRoot, "skills"), "skills")) {
    files.push(windows ? { ...item, rel: supportRel(item.rel) } : item);
  }

  if (platform === "windows") {
    files.push(
      { abs: path.join(agentRoot, "launch-windows.cmd"), rel: "Start Sparkloom.cmd" },
      { abs: path.join(agentRoot, "quickstart-windows.txt"), rel: "README.txt" },
      { abs: path.join(agentRoot, "sparkloom-windows.ps1"), rel: supportRel("sparkloom-windows.ps1") },
      { abs: path.join(agentRoot, "install-windows.ps1"), rel: supportRel("install-windows.ps1") },
      { abs: path.join(agentRoot, "start-windows.ps1"), rel: supportRel("start-windows.ps1") }
    );
  } else {
    files.push(
      { abs: path.join(agentRoot, "install-macos.sh"), rel: "install-macos.sh" },
      { abs: path.join(agentRoot, "start-macos.sh"), rel: "start-macos.sh" }
    );
  }

  return files
    .sort((a, b) => compareStrings(a.rel, b.rel))
    .map((file) => readEntry(file.abs, file.rel));
}

function writeArtifact(platform) {
  const fileName = `sparkloom-agent-${version}-${platform}.zip`;
  const zip = makeZip(buildEntries(platform));
  const file = path.join(outDir, fileName);
  fs.writeFileSync(file, zip);
  return {
    platform,
    file,
    fileName,
    publicPath: `/downloads/studio-agent/${fileName}`,
    bytes: zip.length,
    sha256: createHash("sha256").update(zip).digest("hex"),
  };
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
let canWritePublicDir = true;
let wroteSourceManifest = false;
try {
  fs.mkdirSync(publicDir, { recursive: true });
} catch (error) {
  if (!allowSkipPublic) throw error;
  canWritePublicDir = false;
  console.warn(`[agent:package] skipped ${publicDir}: ${error.message}`);
}
fs.mkdirSync(generatedDir, { recursive: true });

const artifacts = [writeArtifact("windows"), writeArtifact("macos")];
for (const artifact of artifacts) {
  if (canWritePublicDir) fs.copyFileSync(artifact.file, path.join(publicDir, artifact.fileName));
}

const manifest = {
  name: "sparkloom-agent",
  version,
  generatedAt: new Date().toISOString(),
  artifacts,
  env: {
    STUDIO_AGENT_VERSION: version,
    STUDIO_AGENT_WINDOWS_URL: artifacts.find((item) => item.platform === "windows")?.publicPath,
    STUDIO_AGENT_WINDOWS_SHA256: artifacts.find((item) => item.platform === "windows")?.sha256,
    STUDIO_AGENT_MAC_URL: artifacts.find((item) => item.platform === "macos")?.publicPath,
    STUDIO_AGENT_MAC_SHA256: artifacts.find((item) => item.platform === "macos")?.sha256,
  },
};
const publicManifest = {
  ...manifest,
  artifacts: artifacts.map(({ platform, fileName, publicPath, bytes, sha256 }) => ({
    platform,
    fileName,
    publicPath,
    bytes,
    sha256,
  })),
};
const sourceManifest = {
  name: manifest.name,
  version,
  artifacts: publicManifest.artifacts,
  env: publicManifest.env,
};

const manifestFile = path.join(outDir, "manifest.json");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
if (canWritePublicDir) {
  const manifestTmp = path.join(publicDir, `manifest.${version}.tmp.json`);
  const manifestTarget = path.join(publicDir, "manifest.json");
  fs.writeFileSync(manifestTmp, `${JSON.stringify(publicManifest, null, 2)}\n`);
  fs.renameSync(manifestTmp, manifestTarget);
}
try {
  fs.writeFileSync(
    path.join(generatedDir, "studio-agent-release.ts"),
    [
      "/* This file is generated by scripts/package-agent.mjs. */\n",
      "export const STUDIO_AGENT_RELEASE = ",
      JSON.stringify(sourceManifest, null, 2),
      " as const;\n",
    ].join("")
  );
  wroteSourceManifest = true;
} catch (error) {
  if (!allowSkipPublic) throw error;
  console.warn(`[agent:package] skipped ${path.join(generatedDir, "studio-agent-release.ts")}: ${error.message}`);
}

function assertFileSha256(file, expected) {
  const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${file}: expected ${expected}, got ${actual}`);
  }
}

for (const artifact of artifacts) {
  assertFileSha256(artifact.file, artifact.sha256);
  if (canWritePublicDir) {
    const publicFile = path.join(publicDir, artifact.fileName);
    if (!fs.existsSync(publicFile)) throw new Error(`missing public artifact ${publicFile}`);
    assertFileSha256(publicFile, artifact.sha256);
  }
}

if (!allowSkipPublic && (!canWritePublicDir || !wroteSourceManifest)) {
  throw new Error("agent package publication is incomplete");
}

console.log(`[agent:package] wrote ${outDir}`);
if (canWritePublicDir) console.log(`[agent:package] wrote ${publicDir}`);
if (wroteSourceManifest) console.log(`[agent:package] generated source manifest ${path.join(generatedDir, "studio-agent-release.ts")}`);
for (const artifact of artifacts) {
  console.log(`[agent:package] ${artifact.fileName} ${artifact.bytes} bytes sha256=${artifact.sha256}`);
}
console.log(`[agent:package] manifest ${manifestFile}`);
