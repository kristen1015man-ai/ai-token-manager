import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function listFiles(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) return listFiles(childRel);
    return [childRel.replace(/\\/g, "/")];
  });
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function gitTrackedFiles() {
  return execSync("git ls-files", { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"));
}

function isLikelyPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "true" ||
    normalized === "false" ||
    normalized === "xxx" ||
    normalized.includes("your") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.includes("change-me") ||
    normalized.includes("<") ||
    normalized.includes(">")
  );
}

const publicAdminRoutes = [
  "web/src/app/api/admin/prices/sync/route.ts",
  "web/src/app/api/admin/channels/balance-sync/route.ts",
  "web/src/app/api/admin/anomaly-check/route.ts",
  "web/src/app/api/admin/employee-status-check/route.ts",
  "web/src/app/api/admin/leaderboard-send/route.ts",
  "web/src/app/api/admin/alerts/test-anomaly/route.ts",
  "web/src/app/api/setup/sync-feishu/route.ts",
];

for (const rel of publicAdminRoutes) {
  const source = read(rel);
  assert(!source.includes("INTERNAL_API_KEY"), `${rel} must not read INTERNAL_API_KEY`);
  assert(!source.includes("Bearer ${internalKey}"), `${rel} must not accept internal Bearer auth`);
}

for (const rel of listFiles("web/src/app/api/admin").filter((file) => file.endsWith("/route.ts"))) {
  const source = read(rel);
  assert(
    source.includes("requireAdmin") || source.includes("requireRole"),
    `${rel} must enforce admin/session role auth`
  );
  assert(!source.includes("requireInternalRequest"), `${rel} must not use internal auth on public admin routes`);
  assert(!source.includes("INTERNAL_API_KEY"), `${rel} must not read INTERNAL_API_KEY`);
}

for (const rel of listFiles("web/src/app/api/setup").filter((file) => file.endsWith("/route.ts"))) {
  const source = read(rel);
  assert(source.includes("requireAdmin"), `${rel} must require an admin session`);
  assert(!source.includes("requireInternalRequest"), `${rel} must not use internal auth on setup routes`);
  assert(!source.includes("INTERNAL_API_KEY"), `${rel} must not read INTERNAL_API_KEY`);
}

const seedRoute = read("web/src/app/api/setup/seed/route.ts");
for (const token of ["NODE_ENV", "production", "ENABLE_SEED_ENDPOINT", "isLocalRequest"]) {
  assert(seedRoute.includes(token), `seed route must keep production/local guard: ${token}`);
}

const cleanupExecuteRoute = read("web/src/app/api/admin/cleanup-execute/route.ts");
assert(cleanupExecuteRoute.includes("process.env.NODE_ENV !== \"production\""), "cleanup execute must stay disabled in production");
assert(cleanupExecuteRoute.includes("ENABLE_CLEANUP_ENDPOINT"), "cleanup execute must require explicit non-production flag");

const debugRoute = read("web/src/app/api/admin/debug/route.ts");
assert(debugRoute.includes("process.env.NODE_ENV === \"production\""), "debug route must stay disabled in production");
assert(debugRoute.includes("ENABLE_DEBUG_ENDPOINT"), "debug route must require explicit flag");

const internalAdminRoutes = [
  "web/src/app/api/internal/admin/backup/route.ts",
  "web/src/app/api/internal/admin/flush-db/route.ts",
  "web/src/app/api/internal/admin/reset-billing/route.ts",
  "web/src/app/api/internal/admin/sync-feishu/route.ts",
  "web/src/app/api/internal/admin/prices/sync/route.ts",
  "web/src/app/api/internal/admin/channels/balance-sync/route.ts",
  "web/src/app/api/internal/admin/anomaly-check/route.ts",
  "web/src/app/api/internal/admin/employee-status-check/route.ts",
  "web/src/app/api/internal/admin/leaderboard-send/route.ts",
];

for (const rel of internalAdminRoutes) {
  assert(exists(rel), `${rel} must exist`);
  const source = read(rel);
  assert(source.includes("requireInternalRequest"), `${rel} must require internal Bearer auth`);
}

for (const rel of listFiles("web/src/app/api/internal").filter((file) => file.endsWith("/route.ts"))) {
  const source = read(rel);
  assert(source.includes("requireInternalRequest"), `${rel} must require internal Bearer auth`);
}

const proxyMiddleware = read("web/src/proxy.ts");
const internalAllowedPathsToken = "INTERNAL_API_" + "ALLOWED_PATHS";
assert(!proxyMiddleware.includes(internalAllowedPathsToken), "web/src/proxy.ts must not whitelist public admin paths for internal auth");

const autoSync = read("web/src/lib/auto-sync.ts");
for (const suffix of [
  "/api/internal/admin/sync-feishu",
  "/api/internal/admin/prices/sync",
  "/api/internal/admin/channels/balance-sync",
  "/api/internal/admin/anomaly-check",
  "/api/internal/admin/employee-status-check",
  "/api/internal/admin/leaderboard-send",
]) {
  assert(autoSync.includes(suffix), `auto-sync must call ${suffix}`);
}

const instrumentation = read("web/src/instrumentation.ts");
assert(
  instrumentation.includes("runStartupBackupDrillIfEnabled"),
  "web instrumentation must keep the default-disabled startup backup drill hook"
);
const verifiedBackup = read("web/src/lib/verified-backup.ts");
for (const token of [
  "RUN_BACKUP_DRILL_ON_START",
  "BACKUP_DRILL_RUN_ID",
  "PRAGMA integrity_check",
  "[BackupDrill] completed",
]) {
  assert(verifiedBackup.includes(token), `verified backup helper must keep ${token}`);
}

const railwayStart = read("railway/start.mjs");
for (const token of [
  "PRODUCTION_DISABLED_FLAGS",
  "isProductionRuntime",
  "assertStrongSecret",
  "assertFeishuConfig",
  "BAD_FEISHU_APP_PREFIX",
  "assertCorsOrigins",
  "assertUpstreamAllowlist",
  "ALLOW_EPHEMERAL_DATA",
]) {
  assert(railwayStart.includes(token), `railway/start.mjs must keep production fail-fast check: ${token}`);
}

const channelRoute = read("web/src/app/api/admin/channels/route.ts");
for (const token of [
  "assertSafeUpstreamBaseUrl",
  "status must be active or disabled",
  "balanceSyncMode must be auto, manual, or empty",
]) {
  assert(channelRoute.includes(token), `channel admin route must keep validation: ${token}`);
}

const notificationRouter = read("web/src/lib/notification-router.ts");
const fuzzyAdminToken = "%" + "admin" + "%";
assert(!notificationRouter.includes(fuzzyAdminToken), "notification router must not use fuzzy admin role matching");
assert(notificationRouter.includes("parseRoles"), "notification router must use parseRoles for admin recipient checks");

const productionEnv = read(".env.production.example");
const deprecatedAdminEmailsToken = "ADMIN_" + "EMAILS";
assert(!productionEnv.includes(deprecatedAdminEmailsToken), ".env.production.example must not expose deprecated admin email variable");

const apiDocs = read("docs/API.md");
assert(apiDocs.includes("`/api/internal/admin/backup`"), "docs/API.md must document the internal backup route");
for (const line of apiDocs.split(/\r?\n/)) {
  const publicAdminLine =
    line.includes("`/api/admin/") ||
    line.includes("`/api/setup/sync-feishu`");
  assert(
    !publicAdminLine || !/\binternal\b/i.test(line),
    `docs/API.md must not describe public route as internal-callable: ${line}`
  );
}

const rootPkg = JSON.parse(read("package.json"));
const sharedPkg = JSON.parse(read("shared/package.json"));
const dbGenerateScript = "db:" + "generate";
assert(!rootPkg.scripts?.[dbGenerateScript], "root package must not expose a non-source-of-truth db generate script");
assert(!sharedPkg.scripts?.[dbGenerateScript], "shared package must not expose a non-source-of-truth db generate script");
assert(sharedPkg.scripts?.["db:migrate"] === "node run-migrate.mjs", "shared db:migrate must use the checked-in migration runner");
assert(Boolean(sharedPkg.devDependencies?.esbuild), "shared package must include esbuild for the migration runner");

for (const [rel, forbidden] of [
  ["seed.ts", "sk-emp-" + "TESTKEY_ONLY_FOR_DEV"],
  ["seed-mock.ts", "sk-emp-" + "test12345678"],
  ["web/src/app/api/setup/seed/route.ts", "sk-emp-" + "heguangming-dev-key"],
  ["ai-token-manager.md", "sk-emp-" + "zhangsan-abc123"],
]) {
  if (!exists(rel)) continue;
  assert(!read(rel).includes(forbidden), `${rel} contains forbidden fixed key: ${forbidden}`);
}

const trackedFiles = gitTrackedFiles();
const envLikeFiles = trackedFiles.filter((file) =>
  file === ".env" ||
  file.startsWith(".env.") ||
  file.endsWith(".env") ||
  file.endsWith(".env.example")
);
const secretEnvName = /(?:SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|APP_SECRET)$/i;
const allowedNonSecretEnvNames = new Set([
  "NEXT_PUBLIC_FEISHU_APP_ID",
  "NEXT_PUBLIC_FEISHU_REDIRECT_URI",
  "PUBLIC_PROXY_BASE_URL",
  "CORS_ALLOWED_ORIGINS",
  "UPSTREAM_ALLOWED_HOSTS",
  "ADMIN_IDS",
  "NODE_ENV",
  "DATABASE_URL",
  "WEB_URL",
  "PROXY_BASE_URL",
]);
for (const rel of envLikeFiles) {
  for (const [index, line] of read(rel).split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    if (allowedNonSecretEnvNames.has(name) || !secretEnvName.test(name)) continue;
    assert(
      isLikelyPlaceholder(value),
      `${rel}:${index + 1} must not contain a concrete secret value for ${name}`
    );
  }
}

const secretLikePattern = /(sk-(?:emp|proj|ant|or)?-[A-Za-z0-9_-]{16,}|cli_[A-Za-z0-9]{20,}|(?:APP_SECRET|FEISHU_APP_SECRET)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,})/g;
const secretScanAllowlist = new Set([
  ".env.production.example",
  "docs/OPERATIONS.md",
  "docs/backup-restore.md",
  "docs/HANDOFF-EVIDENCE-2026-06-20.md",
]);
for (const rel of trackedFiles) {
  if (secretScanAllowlist.has(rel)) continue;
  if (rel.endsWith(".png") || rel.endsWith(".jpg") || rel.endsWith(".jpeg") || rel.endsWith(".ico") || rel.endsWith(".db")) continue;
  const abs = path.join(root, rel);
  const stat = fs.statSync(abs);
  if (stat.size > 1024 * 1024) continue;
  const source = fs.readFileSync(abs, "utf8");
  const matches = source.match(secretLikePattern);
  assert(!matches, `${rel} contains secret-like literals: ${matches?.slice(0, 3).join(", ")}`);
}

if (failures.length > 0) {
  console.error("Handoff gate failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Handoff gate passed");
