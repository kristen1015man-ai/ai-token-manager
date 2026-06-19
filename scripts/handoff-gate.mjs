import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function assert(condition, message) {
  if (!condition) failures.push(message);
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

const railwayStart = read("railway/start.mjs");
for (const token of [
  "PRODUCTION_DISABLED_FLAGS",
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

if (failures.length > 0) {
  console.error("Handoff gate failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Handoff gate passed");
