import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function runJson(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    return {
      ...JSON.parse(result.stdout || "{}"),
      exitCode: result.status,
      stderr: result.stderr || undefined,
    };
  } catch {
    return {
      ok: false,
      exitCode: result.status,
      raw: result.stdout || "",
      stderr: result.stderr || undefined,
    };
  }
}

function readJsonEvidence(filePath) {
  if (!filePath) {
    return {
      provided: false,
      value: null,
      error: null,
    };
  }
  try {
    return {
      provided: true,
      value: JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      provided: true,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function git(gitArgs) {
  return execFileSync("git", gitArgs, { cwd: process.cwd(), encoding: "utf8" }).trim();
}

const uatEvidencePath = argValue("--uat-evidence");
const backupVerificationPath = argValue("--backup-verification");
const assetSignoffPath = argValue("--asset-signoff");

const expectedProject = "Sparkloom";
const expectedHandoffTag = "handoff-2026-06-20";
const minSignoffTime = Date.parse("2026-06-20T00:00:00+08:00");
const requiredAssetIds = [
  "code-repository",
  "railway-project",
  "domain-dns",
  "feishu-app",
  "supplier-accounts",
  "notification-groups",
  "production-secrets",
  "backup-storage",
];

const placeholderTokens = [
  "todo",
  "tbd",
  "placeholder",
  "example",
  "yourcompany",
  "change-me",
  "xxx",
  "待填",
  "截图",
  "受控目录",
  "path/to",
  "<",
  ">",
];
const secretLikePatterns = [
  /sk-emp-[A-Za-z0-9_-]+/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
  /cli_[A-Za-z0-9]{12,}/,
  /(secret|token|password|cookie)\s*[:=]\s*\S+/i,
];

function baseValidation(readResult, extra = {}) {
  return {
    provided: readResult?.provided === true,
    complete: false,
    schemaErrors: [],
    ...extra,
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function containsPlaceholder(value) {
  if (!nonEmptyString(value)) return true;
  const lower = value.trim().toLowerCase();
  return placeholderTokens.some((token) => lower.includes(token.toLowerCase()));
}

function containsSecretLikeValue(value) {
  if (!nonEmptyString(value)) return false;
  return secretLikePatterns.some((pattern) => pattern.test(value));
}

function validPlainTextRef(value) {
  return nonEmptyString(value) && !containsPlaceholder(value) && !containsSecretLikeValue(value);
}

function validEvidenceRef(value) {
  return validPlainTextRef(value) && value.trim().length >= 8;
}

function validatePlainTextField(value, schemaErrors, fieldName) {
  if (!validPlainTextRef(value)) {
    schemaErrors.push(`${fieldName} must be non-empty, non-placeholder, and must not contain secrets`);
    return false;
  }
  return true;
}

function validateEvidenceField(value, schemaErrors, fieldName) {
  if (!validEvidenceRef(value)) {
    schemaErrors.push(`${fieldName} must be a non-placeholder evidence reference and must not contain secrets`);
    return false;
  }
  return true;
}

function validateBooleanTrue(value, schemaErrors, fieldName) {
  if (value !== true) {
    schemaErrors.push(`${fieldName} must be true`);
    return false;
  }
  return true;
}

function validTimestamp(value, schemaErrors, fieldName) {
  if (!nonEmptyString(value)) {
    if (fieldName === "completedAt") {
      schemaErrors.push("completedAt is required");
    } else {
      schemaErrors.push(`${fieldName} is required`);
    }
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    if (fieldName === "completedAt") {
      schemaErrors.push("completedAt must be an ISO-like timestamp");
    } else {
      schemaErrors.push(`${fieldName} must be an ISO-like timestamp`);
    }
    return false;
  }
  if (parsed < minSignoffTime) {
    schemaErrors.push(`${fieldName} must be on or after the handoff window`);
    return false;
  }
  if (parsed > Date.now() + 5 * 60 * 1000) {
    schemaErrors.push(`${fieldName} must not be in the future`);
    return false;
  }
  return true;
}

function collectSecretLikePaths(value, prefix = "$", paths = []) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value)) paths.push(prefix);
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretLikePaths(item, `${prefix}[${index}]`, paths));
    return paths;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectSecretLikePaths(child, `${prefix}.${key}`, paths);
    }
  }
  return paths;
}

function validateNoSecretsAnywhere(signoff, schemaErrors) {
  const secretPaths = collectSecretLikePaths(signoff);
  if (secretPaths.length > 0) {
    schemaErrors.push(`sign-off JSON must not contain secret-like values: ${secretPaths.slice(0, 10).join(", ")}`);
    return false;
  }
  return true;
}

function validateSignoffHeader(signoff, schemaErrors) {
  const checks = [];
  checks.push(validateNoSecretsAnywhere(signoff, schemaErrors));
  if (signoff?.schemaVersion !== 1) {
    schemaErrors.push("schemaVersion must be 1");
    checks.push(false);
  }
  if (signoff?.project !== expectedProject) {
    schemaErrors.push(`project must be ${expectedProject}`);
    checks.push(false);
  }
  if (signoff?.handoffTag !== expectedHandoffTag) {
    schemaErrors.push(`handoffTag must be ${expectedHandoffTag}`);
    checks.push(false);
  }
  if (!validPlainTextRef(signoff?.completedBy)) {
    schemaErrors.push("completedBy is required");
    checks.push(false);
  }
  checks.push(validTimestamp(signoff?.completedAt, schemaErrors, "completedAt"));
  return checks.every(Boolean);
}

function validHttpsBaseUrl(value) {
  if (!nonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function validateAssetSignoff(signoff, readResult) {
  if (readResult?.error) {
    return baseValidation(readResult, {
      readError: readResult.error,
      missingAssetIds: requiredAssetIds,
      invalidExtraAssetIds: [],
      incompleteAssetIds: [],
      invalidAssetIds: [],
    });
  }
  if (!signoff) {
    return baseValidation(readResult, {
      missingAssetIds: requiredAssetIds,
      invalidExtraAssetIds: [],
      incompleteAssetIds: [],
      invalidAssetIds: [],
    });
  }

  const schemaErrors = [];
  const headerOk = validateSignoffHeader(signoff, schemaErrors);
  if (!Array.isArray(signoff.assets)) {
    schemaErrors.push("assets must be an array");
  }

  const assets = Array.isArray(signoff.assets) ? signoff.assets : [];
  const byId = new Map(assets.map((asset) => [asset?.id, asset]));
  const missingAssetIds = requiredAssetIds.filter((id) => !byId.has(id));
  const invalidExtraAssetIds = assets
    .map((asset) => asset?.id)
    .filter((id) => nonEmptyString(id) && !requiredAssetIds.includes(id));
  const incompleteAssetIds = [];
  const invalidAssetIds = [];

  for (const id of requiredAssetIds) {
    const asset = byId.get(id);
    if (!asset) continue;
    if (asset.complete !== true) incompleteAssetIds.push(id);
    const ownerOk = validatePlainTextField(asset.owner, schemaErrors, `${id}.owner`);
    const permissionOk = validatePlainTextField(asset.permission, schemaErrors, `${id}.permission`);
    const evidenceOk = validateEvidenceField(asset.evidenceRef, schemaErrors, `${id}.evidenceRef`);
    if (!ownerOk || !permissionOk || !evidenceOk) {
      invalidAssetIds.push(id);
    }
  }

  return {
    provided: true,
    complete:
      headerOk &&
      schemaErrors.length === 0 &&
      missingAssetIds.length === 0 &&
      invalidExtraAssetIds.length === 0 &&
      incompleteAssetIds.length === 0 &&
      invalidAssetIds.length === 0,
    missingAssetIds,
    invalidExtraAssetIds,
    incompleteAssetIds,
    invalidAssetIds,
    schemaErrors,
  };
}

function validateBusinessUatSignoff(signoff, readResult) {
  if (readResult?.error) {
    return baseValidation(readResult, {
      readError: readResult.error,
      automatedEvidenceOk: false,
      usageAuditOk: false,
      securityReviewOk: false,
    });
  }
  if (!signoff) {
    return baseValidation(readResult, {
      automatedEvidenceOk: false,
      usageAuditOk: false,
      securityReviewOk: false,
    });
  }

  const schemaErrors = [];
  const headerOk = validateSignoffHeader(signoff, schemaErrors);

  if (!signoff.automatedEvidence) schemaErrors.push("automatedEvidence section is required; raw handoff-uat evidence alone is not enough");
  if (!signoff.usageAudit) schemaErrors.push("usageAudit section is required");
  if (!signoff.securityReview) schemaErrors.push("securityReview section is required");

  const checks = signoff.automatedEvidence?.checks || {};
  const automatedBaseUrlOk = validHttpsBaseUrl(signoff.automatedEvidence?.baseUrl);
  if (!automatedBaseUrlOk) schemaErrors.push("automatedEvidence.baseUrl must be an https production or staging URL");
  const automatedEvidenceOk = [
    validateBooleanTrue(signoff.automatedEvidence?.complete, schemaErrors, "automatedEvidence.complete"),
    validateBooleanTrue(signoff.automatedEvidence?.formalBusinessUatComplete, schemaErrors, "automatedEvidence.formalBusinessUatComplete"),
    automatedBaseUrlOk,
    validTimestamp(signoff.automatedEvidence?.generatedAt, schemaErrors, "automatedEvidence.generatedAt"),
    validateEvidenceField(signoff.automatedEvidence?.evidenceRef, schemaErrors, "automatedEvidence.evidenceRef"),
    validateEvidenceField(signoff.automatedEvidence?.redactedOutputRef, schemaErrors, "automatedEvidence.redactedOutputRef"),
    validateBooleanTrue(checks.handoffStatusOk, schemaErrors, "automatedEvidence.checks.handoffStatusOk"),
    validateBooleanTrue(checks.publicSmokeOk, schemaErrors, "automatedEvidence.checks.publicSmokeOk"),
    validateBooleanTrue(checks.employeeModelsOk, schemaErrors, "automatedEvidence.checks.employeeModelsOk"),
    validateBooleanTrue(checks.billableChatOk, schemaErrors, "automatedEvidence.checks.billableChatOk"),
    validateBooleanTrue(checks.billableStreamOk, schemaErrors, "automatedEvidence.checks.billableStreamOk"),
  ].every(Boolean);

  const usageAuditOk = [
    validateBooleanTrue(signoff.usageAudit?.complete, schemaErrors, "usageAudit.complete"),
    validatePlainTextField(signoff.usageAudit?.auditor, schemaErrors, "usageAudit.auditor"),
    validTimestamp(signoff.usageAudit?.auditedAt, schemaErrors, "usageAudit.auditedAt"),
    validatePlainTextField(signoff.usageAudit?.model, schemaErrors, "usageAudit.model"),
    validateEvidenceField(signoff.usageAudit?.requestRef, schemaErrors, "usageAudit.requestRef"),
    validateEvidenceField(signoff.usageAudit?.adminUsageRef, schemaErrors, "usageAudit.adminUsageRef"),
    validateBooleanTrue(signoff.usageAudit?.nonStreamUsageRecorded, schemaErrors, "usageAudit.nonStreamUsageRecorded"),
    validateBooleanTrue(signoff.usageAudit?.streamUsageRecorded, schemaErrors, "usageAudit.streamUsageRecorded"),
    validateBooleanTrue(signoff.usageAudit?.costReconciled, schemaErrors, "usageAudit.costReconciled"),
    validateEvidenceField(signoff.usageAudit?.costEvidenceRef, schemaErrors, "usageAudit.costEvidenceRef"),
  ].every(Boolean);

  const securityReviewOk = [
    validateBooleanTrue(signoff.securityReview?.complete, schemaErrors, "securityReview.complete"),
    validatePlainTextField(signoff.securityReview?.reviewer, schemaErrors, "securityReview.reviewer"),
    validTimestamp(signoff.securityReview?.reviewedAt, schemaErrors, "securityReview.reviewedAt"),
    validateEvidenceField(signoff.securityReview?.evidenceRef, schemaErrors, "securityReview.evidenceRef"),
    validateBooleanTrue(signoff.securityReview?.noSecretsInEvidence, schemaErrors, "securityReview.noSecretsInEvidence"),
  ].every(Boolean);

  return {
    provided: true,
    complete: headerOk && schemaErrors.length === 0 && automatedEvidenceOk && usageAuditOk && securityReviewOk,
    schemaErrors,
    automatedEvidenceOk,
    usageAuditOk,
    securityReviewOk,
  };
}

function validateBackupRestoreSignoff(signoff, readResult) {
  if (readResult?.error) {
    return baseValidation(readResult, {
      readError: readResult.error,
      sqliteVerificationOk: false,
      externalStorageOk: false,
      restoreDrillOk: false,
      rollbackDrillOk: false,
    });
  }
  if (!signoff) {
    return baseValidation(readResult, {
      sqliteVerificationOk: false,
      externalStorageOk: false,
      restoreDrillOk: false,
      rollbackDrillOk: false,
    });
  }

  const schemaErrors = [];
  const headerOk = validateSignoffHeader(signoff, schemaErrors);

  const sqlite = signoff.sqliteVerification;
  if (!sqlite) {
    schemaErrors.push("sqliteVerification section is required; raw verify-sqlite-backup output alone is not enough");
  }
  const sqliteVerificationOk = Boolean(
    sqlite?.ok === true &&
      sqlite?.inputType === "backup-directory" &&
      sqlite?.integrity === "ok" &&
      sqlite?.manifestMatches === true &&
      Array.isArray(sqlite?.missingTables) &&
      sqlite.missingTables.length === 0 &&
      nonEmptyString(sqlite?.sha256) &&
      Number.isFinite(Number(sqlite?.size)) &&
      Number(sqlite.size) > 0 &&
      validateEvidenceField(sqlite?.evidenceRef, schemaErrors, "sqliteVerification.evidenceRef")
  );
  if (sqlite && sqliteVerificationOk !== true) {
    schemaErrors.push("sqliteVerification must come from a complete backup-directory verification with inputType=backup-directory and manifestMatches=true");
  }

  const externalStorageOk = [
    validateBooleanTrue(signoff.externalStorage?.complete, schemaErrors, "externalStorage.complete"),
    validatePlainTextField(signoff.externalStorage?.owner, schemaErrors, "externalStorage.owner"),
    validateEvidenceField(signoff.externalStorage?.locationRef, schemaErrors, "externalStorage.locationRef"),
    validateEvidenceField(signoff.externalStorage?.evidenceRef, schemaErrors, "externalStorage.evidenceRef"),
    validatePlainTextField(signoff.externalStorage?.retentionPolicy, schemaErrors, "externalStorage.retentionPolicy"),
  ].every(Boolean);

  const restoreDrillOk = [
    validateBooleanTrue(signoff.restoreDrill?.complete, schemaErrors, "restoreDrill.complete"),
    validatePlainTextField(signoff.restoreDrill?.executor, schemaErrors, "restoreDrill.executor"),
    validTimestamp(signoff.restoreDrill?.executedAt, schemaErrors, "restoreDrill.executedAt"),
    validatePlainTextField(signoff.restoreDrill?.environment, schemaErrors, "restoreDrill.environment"),
    validateEvidenceField(signoff.restoreDrill?.evidenceRef, schemaErrors, "restoreDrill.evidenceRef"),
    validateEvidenceField(signoff.restoreDrill?.healthCheckRef, schemaErrors, "restoreDrill.healthCheckRef"),
  ].every(Boolean);

  const rollbackDrillOk = [
    validateBooleanTrue(signoff.rollbackDrill?.complete, schemaErrors, "rollbackDrill.complete"),
    validatePlainTextField(signoff.rollbackDrill?.owner, schemaErrors, "rollbackDrill.owner"),
    validateEvidenceField(signoff.rollbackDrill?.evidenceRef, schemaErrors, "rollbackDrill.evidenceRef"),
  ].every(Boolean);

  return {
    provided: true,
    complete:
      headerOk &&
      schemaErrors.length === 0 &&
      sqliteVerificationOk &&
      externalStorageOk &&
      restoreDrillOk &&
      rollbackDrillOk,
    schemaErrors,
    sqliteVerificationOk,
    externalStorageOk,
    restoreDrillOk,
    rollbackDrillOk,
  };
}

const handoffStatus = runJson(process.execPath, ["scripts/handoff-status.mjs", expectedHandoffTag]);
const uatEvidenceRead = readJsonEvidence(uatEvidencePath);
const backupVerificationRead = readJsonEvidence(backupVerificationPath);
const assetSignoffRead = readJsonEvidence(assetSignoffPath);
const businessUatValidation = validateBusinessUatSignoff(uatEvidenceRead.value, uatEvidenceRead);
const assetSignoffValidation = validateAssetSignoff(assetSignoffRead.value, assetSignoffRead);
const backupRestoreValidation = validateBackupRestoreSignoff(backupVerificationRead.value, backupVerificationRead);

const requiredExternalEvidence = [
  {
    id: "business-uat",
    description: "真实员工登录、员工 Key、/v1/models、小额非流式/流式调用、usage 入库和费用核对",
    complete: businessUatValidation.complete,
    evidence: uatEvidencePath || null,
    readError: uatEvidenceRead.error,
    validation: businessUatValidation,
  },
  {
    id: "backup-restore",
    description: "生产备份下载到公司受控存储，并在临时环境完成只读校验和恢复演练",
    complete: backupRestoreValidation.complete,
    evidence: backupVerificationPath || null,
    readError: backupVerificationRead.error,
    validation: backupRestoreValidation,
  },
  {
    id: "asset-handoff",
    description: "代码仓库、Railway、DNS、飞书应用、供应商账号、通知群、生产密钥库、备份存储 owner 和权限交割记录",
    complete: assetSignoffValidation.complete,
    evidence: assetSignoffPath || null,
    validation: assetSignoffValidation,
  },
];

const report = {
  generatedAt: new Date().toISOString(),
  branch: git(["branch", "--show-current"]),
  head: git(["rev-parse", "HEAD"]),
  codeHandoffReady: handoffStatus.ok === true,
  formalSignoffReady: handoffStatus.ok === true && requiredExternalEvidence.every((item) => item.complete),
  checks: {
    handoffStatus,
    requiredExternalEvidence,
  },
  nextActions: requiredExternalEvidence
    .filter((item) => !item.complete)
    .map((item) => `${item.id}: ${item.description}`),
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = hasFlag("--require-formal") && !report.formalSignoffReady ? 1 : 0;
