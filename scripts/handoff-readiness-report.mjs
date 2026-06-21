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

function git(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
}

const uatEvidencePath = argValue("--uat-evidence");
const backupVerificationPath = argValue("--backup-verification");
const assetSignoffPath = argValue("--asset-signoff");

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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validCompletionMetadata(signoff, schemaErrors) {
  if (!nonEmptyString(signoff?.completedBy)) {
    schemaErrors.push("completedBy is required");
  }
  if (!nonEmptyString(signoff?.completedAt)) {
    schemaErrors.push("completedAt is required");
    return;
  }
  const parsed = Date.parse(signoff.completedAt);
  if (!Number.isFinite(parsed)) {
    schemaErrors.push("completedAt must be an ISO-like timestamp");
  }
}

function validateAssetSignoff(signoff, readResult) {
  if (readResult?.error) {
    return {
      provided: true,
      complete: false,
      readError: readResult.error,
      missingAssetIds: requiredAssetIds,
      incompleteAssetIds: [],
      invalidAssetIds: [],
      schemaErrors: [],
    };
  }
  if (!signoff) {
    return {
      provided: readResult?.provided === true,
      complete: false,
      missingAssetIds: requiredAssetIds,
      incompleteAssetIds: [],
      invalidAssetIds: [],
      schemaErrors: [],
    };
  }
  const schemaErrors = [];
  if (!Array.isArray(signoff.assets)) {
    schemaErrors.push("assets must be an array");
  }
  validCompletionMetadata(signoff, schemaErrors);
  const assets = Array.isArray(signoff.assets) ? signoff.assets : [];
  const byId = new Map(assets.map((asset) => [asset?.id, asset]));
  const missingAssetIds = requiredAssetIds.filter((id) => !byId.has(id));
  const incompleteAssetIds = [];
  const invalidAssetIds = [];

  for (const id of requiredAssetIds) {
    const asset = byId.get(id);
    if (!asset) continue;
    if (asset.complete !== true) incompleteAssetIds.push(id);
    if (!nonEmptyString(asset.owner) || !nonEmptyString(asset.permission) || !nonEmptyString(asset.evidenceRef)) {
      invalidAssetIds.push(id);
    }
  }

  return {
    provided: true,
    complete:
      schemaErrors.length === 0 &&
      missingAssetIds.length === 0 &&
      incompleteAssetIds.length === 0 &&
      invalidAssetIds.length === 0,
    missingAssetIds,
    incompleteAssetIds,
    invalidAssetIds,
    schemaErrors,
  };
}

function smokeCheckOk(smokeResult, name) {
  if (!Array.isArray(smokeResult?.checks)) return false;
  return smokeResult.checks.some((check) => check?.name === name && check?.ok === true);
}

function parseTimestamp(value) {
  if (!nonEmptyString(value)) return false;
  return Number.isFinite(Date.parse(value));
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

function validateBusinessUatSignoff(signoff, readResult) {
  if (readResult?.error) {
    return {
      provided: true,
      complete: false,
      readError: readResult.error,
      schemaErrors: [],
      automatedEvidenceOk: false,
      usageAuditOk: false,
      securityReviewOk: false,
    };
  }
  if (!signoff) {
    return {
      provided: readResult?.provided === true,
      complete: false,
      schemaErrors: [],
      automatedEvidenceOk: false,
      usageAuditOk: false,
      securityReviewOk: false,
    };
  }

  const schemaErrors = [];
  validCompletionMetadata(signoff, schemaErrors);

  if (!signoff.automatedEvidence) {
    schemaErrors.push("automatedEvidence section is required; raw handoff-uat evidence alone is not enough");
  }
  if (!signoff.usageAudit) {
    schemaErrors.push("usageAudit section is required");
  }
  if (!signoff.securityReview) {
    schemaErrors.push("securityReview section is required");
  }

  const checks = signoff.automatedEvidence?.checks || {};
  const automatedEvidenceOk = Boolean(
    signoff.automatedEvidence?.complete === true &&
      signoff.automatedEvidence?.formalBusinessUatComplete === true &&
      validHttpsBaseUrl(signoff.automatedEvidence?.baseUrl) &&
      parseTimestamp(signoff.automatedEvidence?.generatedAt) &&
      nonEmptyString(signoff.automatedEvidence?.evidenceRef) &&
      nonEmptyString(signoff.automatedEvidence?.redactedOutputRef) &&
      checks.handoffStatusOk === true &&
      checks.publicSmokeOk === true &&
      checks.employeeModelsOk === true &&
      checks.billableChatOk === true &&
      checks.billableStreamOk === true
  );

  const usageAuditOk = Boolean(
    signoff.usageAudit?.complete === true &&
      nonEmptyString(signoff.usageAudit?.auditor) &&
      parseTimestamp(signoff.usageAudit?.auditedAt) &&
      nonEmptyString(signoff.usageAudit?.model) &&
      nonEmptyString(signoff.usageAudit?.requestRef) &&
      nonEmptyString(signoff.usageAudit?.adminUsageRef) &&
      signoff.usageAudit?.nonStreamUsageRecorded === true &&
      signoff.usageAudit?.streamUsageRecorded === true &&
      signoff.usageAudit?.costReconciled === true &&
      nonEmptyString(signoff.usageAudit?.costEvidenceRef)
  );

  const securityReviewOk = Boolean(
    signoff.securityReview?.complete === true &&
      nonEmptyString(signoff.securityReview?.reviewer) &&
      parseTimestamp(signoff.securityReview?.reviewedAt) &&
      nonEmptyString(signoff.securityReview?.evidenceRef) &&
      signoff.securityReview?.noSecretsInEvidence === true
  );

  return {
    provided: true,
    complete: schemaErrors.length === 0 && automatedEvidenceOk && usageAuditOk && securityReviewOk,
    schemaErrors,
    automatedEvidenceOk,
    usageAuditOk,
    securityReviewOk,
  };
}

function validateBackupRestoreSignoff(signoff, readResult) {
  if (readResult?.error) {
    return {
      provided: true,
      complete: false,
      readError: readResult.error,
      schemaErrors: [],
      sqliteVerificationOk: false,
      externalStorageOk: false,
      restoreDrillOk: false,
      rollbackDrillOk: false,
    };
  }
  if (!signoff) {
    return {
      provided: readResult?.provided === true,
      complete: false,
      schemaErrors: [],
      sqliteVerificationOk: false,
      externalStorageOk: false,
      restoreDrillOk: false,
      rollbackDrillOk: false,
    };
  }

  const schemaErrors = [];
  validCompletionMetadata(signoff, schemaErrors);
  const sqlite = signoff.sqliteVerification || signoff;
  const sqliteVerificationOk = Boolean(
    sqlite?.ok === true &&
      sqlite?.integrity === "ok" &&
      Array.isArray(sqlite?.missingTables) &&
      sqlite.missingTables.length === 0 &&
      nonEmptyString(sqlite?.sha256) &&
      Number.isFinite(Number(sqlite?.size)) &&
      Number(sqlite.size) > 0
  );

  if (!signoff.sqliteVerification) {
    schemaErrors.push("sqliteVerification section is required; raw verify-sqlite-backup output alone is not enough");
  } else if (!nonEmptyString(signoff.sqliteVerification.evidenceRef)) {
    schemaErrors.push("sqliteVerification.evidenceRef is required");
  }

  const externalStorageOk = Boolean(
    signoff.externalStorage?.complete === true &&
      nonEmptyString(signoff.externalStorage.owner) &&
      nonEmptyString(signoff.externalStorage.locationRef) &&
      nonEmptyString(signoff.externalStorage.evidenceRef) &&
      nonEmptyString(signoff.externalStorage.retentionPolicy)
  );
  const restoreDrillOk = Boolean(
    signoff.restoreDrill?.complete === true &&
      nonEmptyString(signoff.restoreDrill.executor) &&
      nonEmptyString(signoff.restoreDrill.executedAt) &&
      nonEmptyString(signoff.restoreDrill.environment) &&
      nonEmptyString(signoff.restoreDrill.evidenceRef) &&
      nonEmptyString(signoff.restoreDrill.healthCheckRef)
  );
  const rollbackDrillOk = Boolean(
    signoff.rollbackDrill?.complete === true &&
      nonEmptyString(signoff.rollbackDrill.owner) &&
      nonEmptyString(signoff.rollbackDrill.evidenceRef)
  );

  return {
    provided: true,
    complete:
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

const handoffStatus = runJson(process.execPath, ["scripts/handoff-status.mjs", "handoff-2026-06-20"]);
const uatEvidenceRead = readJsonEvidence(uatEvidencePath);
const backupVerificationRead = readJsonEvidence(backupVerificationPath);
const assetSignoffRead = readJsonEvidence(assetSignoffPath);
const uatEvidence = uatEvidenceRead.value;
const backupVerification = backupVerificationRead.value;
const assetSignoff = assetSignoffRead.value;
const businessUatValidation = validateBusinessUatSignoff(uatEvidence, uatEvidenceRead);
const assetSignoffValidation = validateAssetSignoff(assetSignoff, assetSignoffRead);
const backupRestoreValidation = validateBackupRestoreSignoff(backupVerification, backupVerificationRead);

const businessUatComplete = businessUatValidation.complete;
const backupRestoreComplete = backupRestoreValidation.complete;

const requiredExternalEvidence = [
  {
    id: "business-uat",
    description: "真实员工登录、员工 Key、/v1/models、小额非流式/流式调用、usage 入库和费用核对",
    complete: businessUatComplete,
    evidence: uatEvidencePath || null,
    readError: uatEvidenceRead.error,
    validation: businessUatValidation,
  },
  {
    id: "backup-restore",
    description: "生产备份下载到公司受控存储，并在临时环境完成只读校验和恢复演练",
    complete: backupRestoreComplete,
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
