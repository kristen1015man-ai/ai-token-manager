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

function existsLocal(rel) {
  return fs.existsSync(path.join(root, rel));
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

for (const rel of [
  ".env",
  ".env.local",
  ".env.production",
  "data.db",
  "web/data.db",
  "web/.next/standalone/web/data.db",
  "backups",
  "send-leaderboard.js",
]) {
  assert(!existsLocal(rel), `local sensitive artifact must be moved out of the handoff workspace: ${rel}`);
}

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

const resetBillingRoute = read("web/src/app/api/internal/admin/reset-billing/route.ts");
for (const token of ["ENABLE_INTERNAL_BILLING_RESET", "x-sparkloom-maintenance-confirm", "reset-billing-usage"]) {
  assert(resetBillingRoute.includes(token), `reset billing route must keep destructive maintenance guard: ${token}`);
}

const proxyIndex = read("proxy/src/index.ts");
for (const token of ["ENABLE_PROXY_USAGE_QUEUE_CLEAR", "x-sparkloom-maintenance-confirm", "reset-billing-usage"]) {
  assert(proxyIndex.includes(token), `proxy usage queue clear must keep destructive maintenance guard: ${token}`);
}
const anthropicService = read("proxy/src/services/anthropic.ts");
for (const token of ["proxyAnthropicCountTokensRequest", "Avoid unmetered upstream calls from count_tokens", "estimateTokens(requestBody)"]) {
  assert(anthropicService.includes(token), `anthropic count_tokens must stay local-only: ${token}`);
}
assert(!anthropicService.includes('sendAnthropicRequest(\n    channel,\n    JSON.stringify(requestBody),\n    "count_tokens"'), "anthropic count_tokens must not call upstream without billing");

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
  "copyOptionalJsonlFile",
  "sourceMissing",
  "usage-queue.jsonl",
  "usage-dead-letter.jsonl",
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
  "assertAdminIds",
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
  "isEncrypted(str)",
  "status must be active or disabled",
  "balanceSyncMode must be auto, manual, or empty",
]) {
  assert(channelRoute.includes(token), `channel admin route must keep validation: ${token}`);
}
const providerSecrets = read("web/src/lib/provider-secrets.ts");
assert(providerSecrets.includes("isEncrypted(key)"), "provider secret validation must reject all encrypted storage values");

const healthRoute = read("web/src/app/api/health/route.ts");
assert(healthRoute.includes("LIKE 'enc:%'"), "health secret decryption check must sample all encrypted secret versions");
for (const token of ["checkPlaintextSecretStorage", "secretStorage", "plaintextCount", "user_api_keys", "access_key_secret"]) {
  assert(healthRoute.includes(token), `health route must detect plaintext stored secrets: ${token}`);
}

const notificationRouter = read("web/src/lib/notification-router.ts");
const fuzzyAdminToken = "%" + "admin" + "%";
assert(!notificationRouter.includes(fuzzyAdminToken), "notification router must not use fuzzy admin role matching");
assert(notificationRouter.includes("parseRoles"), "notification router must use parseRoles for admin recipient checks");

const productionEnv = read(".env.production.example");
const localEnvExample = read(".env.example");
const deprecatedAdminEmailsToken = "ADMIN_" + "EMAILS";
assert(!productionEnv.includes(deprecatedAdminEmailsToken), ".env.production.example must not expose deprecated admin email variable");
assert(productionEnv.includes("WEB_PORT_INTERNAL=3000"), ".env.production.example must document WEB_PORT_INTERNAL for Railway single-image routing");
assert(productionEnv.includes("railway/start.mjs"), ".env.production.example must describe Railway port variable ownership");
assert(productionEnv.includes("ENABLE_INTERNAL_BILLING_RESET=false"), ".env.production.example must keep billing reset disabled by default");
assert(productionEnv.includes("ENABLE_PROXY_USAGE_QUEUE_CLEAR=false"), ".env.production.example must keep proxy queue clear disabled by default");
assert(productionEnv.includes("MAX_USER_API_KEYS_PER_USER=5"), ".env.production.example must document employee key count limit");
assert(productionEnv.includes("USER_API_KEY_CREATE_COOLDOWN_SECONDS=60"), ".env.production.example must document employee key creation cooldown");
assert(productionEnv.includes("USAGE_QUEUE_FILE=/usage/usage-queue.jsonl"), ".env.production.example must document shared usage queue path");
assert(productionEnv.includes("USAGE_DEAD_LETTER_FILE=/usage/usage-dead-letter.jsonl"), ".env.production.example must document shared usage dead-letter path");
assert(localEnvExample.includes("USAGE_QUEUE_FILE=../.tmp/usage-queue.jsonl"), ".env.example must document local usage queue path");
assert(localEnvExample.includes("USAGE_DEAD_LETTER_FILE=../.tmp/usage-dead-letter.jsonl"), ".env.example must document local usage dead-letter path");
const userKeyRoute = read("web/src/app/api/user/key/route.ts");
for (const token of ["MAX_USER_API_KEYS_PER_USER", "USER_API_KEY_CREATE_COOLDOWN_SECONDS", "429"]) {
  assert(userKeyRoute.includes(token), `user API key route must keep abuse control: ${token}`);
}
const dockerCompose = read("docker-compose.yml");
assert(dockerCompose.includes("CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:?"), "docker-compose.yml must require explicit CORS_ALLOWED_ORIGINS");
assert(dockerCompose.includes("PUBLIC_PROXY_BASE_URL=${PUBLIC_PROXY_BASE_URL:?"), "docker-compose.yml must require explicit PUBLIC_PROXY_BASE_URL");
for (const token of [
  "USAGE_QUEUE_FILE=/usage/usage-queue.jsonl",
  "USAGE_DEAD_LETTER_FILE=/usage/usage-dead-letter.jsonl",
  "usage-data:/usage",
  "usage-data:",
]) {
  assert(dockerCompose.includes(token), `docker-compose.yml must keep shared usage backup volume: ${token}`);
}
assert(!dockerCompose.includes("proxy-data:/proxy-data"), "docker-compose.yml must not isolate proxy usage queue from web backup");

const sharedCrypto = read("shared/crypto.ts");
for (const token of [
  "hkdfSync",
  "derivePurposeKey",
  "enc:v2:",
  "h2:",
  "legacySearchableHash",
  "searchableHashes",
  "encryption:aes-256-gcm",
  "searchable-hmac:sha256",
]) {
  assert(sharedCrypto.includes(token), `shared crypto must keep separated v2 key derivation support: ${token}`);
}
const authenticateRoute = read("web/src/app/api/internal/proxy/authenticate/route.ts");
for (const token of ["searchableHashes", "findStoredApiKeyByHashes", "UPDATE user_api_keys SET key_hash"]) {
  assert(authenticateRoute.includes(token), `proxy authenticate must keep legacy/new API key hash compatibility: ${token}`);
}
const ensureTables = read("web/src/lib/ensure-tables.ts");
assert(
  !ensureTables.includes("DELETE FROM user_api_keys"),
  "startup table migration must not delete all employee API keys"
);
assert(
  ensureTables.includes("Never delete the whole user_api_keys table on startup"),
  "startup table migration must document why employee API keys are preserved"
);
const proxyCache = read("web/src/lib/proxy/cache.ts");
assert(proxyCache.includes("where(eq(modelPrices.deprecated, false))"), "pricing cache must exclude deprecated model prices");
const internalProxyChannels = read("web/src/app/api/internal/proxy/channels/route.ts");
assert(internalProxyChannels.includes("where(eq(modelPrices.deprecated, false))"), "proxy channel model list must exclude deprecated prices");
const readinessReport = read("scripts/handoff-readiness-report.mjs");
for (const token of ["completedBy is required", "completedAt is required", "completedAt must be an ISO-like timestamp"]) {
  assert(readinessReport.includes(token), `handoff readiness must require sign-off metadata: ${token}`);
}

const apiDocs = read("docs/API.md");
assert(apiDocs.includes("`/api/internal/admin/backup`"), "docs/API.md must document the internal backup route");
const gitignore = read(".gitignore");
for (const token of [
  "handoff-evidence/",
  "handoff-uat-evidence-*.json",
  "handoff-business-uat-signoff.json",
  "handoff-business-uat-signoff-*.json",
  "handoff-asset-signoff.json",
  "handoff-asset-signoff-*.json",
  "handoff-backup-restore-signoff.json",
  "handoff-backup-restore-signoff-*.json",
]) {
  assert(gitignore.includes(token), `.gitignore must keep ${token}`);
}
assert(exists("docs/HANDOFF-UAT-SIGNOFF.md"), "handoff UAT sign-off document must exist");
assert(exists("docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json"), "handoff business UAT sign-off template must exist");
assert(exists("docs/HANDOFF-ASSET-SIGNOFF.template.json"), "handoff asset sign-off template must exist");
assert(exists("docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json"), "handoff backup/restore sign-off template must exist");
assert(exists("scripts/verify-sqlite-backup.mjs"), "SQLite backup verification script must exist");
assert(exists("scripts/production-smoke.mjs"), "production smoke script must exist");
assert(exists("scripts/handoff-status.mjs"), "handoff status script must exist");
assert(exists("scripts/handoff-uat-evidence.mjs"), "handoff UAT evidence script must exist");
assert(exists("scripts/handoff-readiness-report.mjs"), "handoff readiness report script must exist");
assert(exists("scripts/handoff-final-check.mjs"), "handoff final check script must exist");
const uatSignoff = read("docs/HANDOFF-UAT-SIGNOFF.md");
for (const token of [
  "登录与权限",
  "员工 Key 与客户端调用",
  "模型调用与计费",
  "灾备与恢复",
  "资产交割",
]) {
  assert(uatSignoff.includes(token), `handoff UAT sign-off must cover ${token}`);
}
const backupVerifier = read("scripts/verify-sqlite-backup.mjs");
for (const token of ["PRAGMA integrity_check", "missingTables", "sha256", "backup-directory", "usage-dead-letter.jsonl", "manifestMatches", "process.exitCode"]) {
  assert(backupVerifier.includes(token), `backup verifier must keep ${token}`);
}
for (const table of ["user_api_keys", "quota_reservations", "alert_settings", "admin_logs", "sync_blacklist", "system_flags"]) {
  assert(backupVerifier.includes(`"${table}"`), `backup verifier must require operational table: ${table}`);
}
assert(!backupVerifier.includes("files.usageQueue === null"), "backup verifier must not accept a null usage queue manifest entry for directory sign-off");
assert(!backupVerifier.includes("files.usageDeadLetter === null"), "backup verifier must not accept a null dead-letter manifest entry for directory sign-off");
const productionSmoke = read("scripts/production-smoke.mjs");
for (const token of [
  "/health",
  "/api/health",
  "/api/internal/admin/backup",
  "/api/setup/seed",
  "SPARKLOOM_EMPLOYEE_API_KEY",
  "--allow-billable",
  "--include-stream",
  "--require-employee",
  "--require-billable",
  "--require-stream",
  "skippedChecks",
  "complete",
  "process.exitCode",
]) {
  assert(productionSmoke.includes(token), `production smoke must keep ${token}`);
}
const handoffStatus = read("scripts/handoff-status.mjs");
for (const token of ["rev-list", "tagMatchesHead", "workspaceClean", "dirtyFiles", "process.exitCode"]) {
  assert(handoffStatus.includes(token), `handoff status must keep ${token}`);
}
const handoffUatEvidence = read("scripts/handoff-uat-evidence.mjs");
for (const token of [
  "SPARKLOOM_EMPLOYEE_API_KEY",
  "--allow-billable",
  "--include-stream",
  "formalBusinessUatComplete",
  "smokeCheckOk",
  "employee billable stream chat",
  "redactText",
  "handoff-status.mjs",
  "production-smoke.mjs",
  "process.exitCode",
]) {
  assert(handoffUatEvidence.includes(token), `handoff UAT evidence must keep ${token}`);
}
const handoffReadiness = read("scripts/handoff-readiness-report.mjs");
for (const token of [
  "expectedHandoffTag",
  "expectedProject",
  "formalSignoffReady",
  "codeHandoffReady",
  "validateSignoffHeader",
  "schemaVersion must be 1",
  "handoffTag must be",
  "project must be",
  "containsSecretLikeValue",
  "validEvidenceRef",
  "sign-off JSON must not contain secret-like values",
  "formalBusinessUatComplete",
  "validateBusinessUatSignoff",
  "automatedEvidenceOk",
  "usageAuditOk",
  "securityReviewOk",
  "costReconciled",
  "billableStreamOk",
  "validHttpsBaseUrl",
  "handoffStatus",
  "publicSmoke",
  "validateBackupRestoreSignoff",
  "externalStorageOk",
  "restoreDrillOk",
  "rollbackDrillOk",
  "inputType=backup-directory",
  "manifestMatches=true",
  "--require-formal",
  "validateAssetSignoff",
  "readJsonEvidence",
  "readError",
  "schemaErrors",
  "business-uat",
  "backup-restore",
  "asset-handoff",
  "requiredAssetIds",
  "--uat-evidence",
  "--backup-verification",
  "--asset-signoff",
]) {
  assert(handoffReadiness.includes(token), `handoff readiness report must keep ${token}`);
}
const businessUatTemplate = JSON.parse(read("docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json"));
for (const token of ["automatedEvidence", "usageAudit", "securityReview"]) {
  assert(Object.hasOwn(businessUatTemplate, token), `handoff business UAT template must include ${token}`);
}
for (const token of ["nonStreamUsageRecorded", "streamUsageRecorded", "costReconciled"]) {
  assert(Object.hasOwn(businessUatTemplate.usageAudit || {}, token), `handoff business UAT usage audit must include ${token}`);
}
const assetTemplate = JSON.parse(read("docs/HANDOFF-ASSET-SIGNOFF.template.json"));
const templateAssetIds = new Set((assetTemplate.assets || []).map((asset) => asset.id));
for (const id of [
  "code-repository",
  "railway-project",
  "domain-dns",
  "feishu-app",
  "supplier-accounts",
  "notification-groups",
  "production-secrets",
  "backup-storage",
]) {
  assert(templateAssetIds.has(id), `handoff asset template must include ${id}`);
}
const backupRestoreTemplate = JSON.parse(read("docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json"));
for (const token of ["sqliteVerification", "externalStorage", "restoreDrill", "rollbackDrill"]) {
  assert(Object.hasOwn(backupRestoreTemplate, token), `handoff backup/restore template must include ${token}`);
}
for (const token of ["inputType", "manifestMatches", "evidenceRef"]) {
  assert(
    Object.hasOwn(backupRestoreTemplate.sqliteVerification || {}, token),
    `handoff backup/restore sqlite verification template must include ${token}`
  );
}
assert(
  backupRestoreTemplate.sqliteVerification?.notes?.includes("backup-directory"),
  "handoff backup/restore template must tell receivers to verify the full backup directory"
);
const backupRestoreDocs = read("docs/backup-restore.md");
for (const token of ["0 字节空文件", "usage-queue.jsonl", "usage-dead-letter.jsonl", "manifest"]) {
  assert(backupRestoreDocs.includes(token), `backup/restore docs must explain stable backup set files: ${token}`);
}
const nginxConf = read("nginx/nginx.conf");
for (const token of ["location /v1/", "location /anthropic/", "proxy_buffering off", "proxy_read_timeout 600s"]) {
  assert(nginxConf.includes(token), `nginx reverse proxy must keep ${token}`);
}
const forwardedHostCount = (nginxConf.match(/X-Forwarded-Host/g) || []).length;
assert(forwardedHostCount >= 5, "nginx reverse proxy must forward X-Forwarded-Host for web, proxy, anthropic, and health routes");
for (const rel of [
  "docs/README.md",
  "docs/HANDOFF-UAT-SIGNOFF.md",
  "docs/HANDOVER.md",
  "docs/ACCEPTANCE-GAP-REPORT.md",
  "docs/HANDOFF-EVIDENCE-2026-06-20.md",
  "docs/RELEASE-CHECKLIST.md",
]) {
  const source = read(rel);
  assert(source.includes("HANDOFF-BUSINESS-UAT-SIGNOFF.template.json"), `${rel} must document the business UAT sign-off template`);
  assert(source.includes("HANDOFF-ASSET-SIGNOFF.template.json"), `${rel} must document the asset sign-off template`);
  assert(source.includes("HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json"), `${rel} must document the backup/restore sign-off template`);
}
for (const rel of ["docs/README.md", "docs/HANDOVER.md", "docs/OPERATIONS.md", "docs/RELEASE-CHECKLIST.md"]) {
  assert(read(rel).includes("smoke:production:full"), `${rel} must document the full production smoke command`);
}
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
assert(
  rootPkg.scripts?.["smoke:production"] === "node scripts/production-smoke.mjs --base https://ai.seapllo.com",
  "root package must expose the production smoke command"
);
assert(
  rootPkg.scripts?.["smoke:production:full"] === "node scripts/production-smoke.mjs --base https://ai.seapllo.com --require-employee --allow-billable --require-billable --include-stream --require-stream",
  "root package must expose the full production smoke command"
);
assert(
  rootPkg.scripts?.check === "node scripts/check.mjs",
  "root package must expose the aggregate check command"
);
const aggregateCheck = read("scripts/check.mjs");
for (const token of ["handoff gate", "proxy build", "web build", "spawnSync"]) {
  assert(aggregateCheck.includes(token), `aggregate check script must keep ${token}`);
}
assert(
  rootPkg.scripts?.["handoff:status"] === "node scripts/handoff-status.mjs handoff-2026-06-20",
  "root package must expose the handoff status command"
);
assert(
  rootPkg.scripts?.["handoff:uat"] === "node scripts/handoff-uat-evidence.mjs --base https://ai.seapllo.com",
  "root package must expose the handoff UAT evidence command"
);
assert(
  rootPkg.scripts?.["handoff:readiness"] === "node scripts/handoff-readiness-report.mjs",
  "root package must expose the handoff readiness report command"
);
assert(
  rootPkg.scripts?.["handoff:final"] === "node scripts/handoff-final-check.mjs",
  "root package must expose the handoff final check command"
);
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
  if (!fs.existsSync(abs)) continue;
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
