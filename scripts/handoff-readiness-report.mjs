import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
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

const handoffStatus = runJson(process.execPath, ["scripts/handoff-status.mjs", "handoff-2026-06-20"]);
const uatEvidenceRead = readJsonEvidence(uatEvidencePath);
const backupVerificationRead = readJsonEvidence(backupVerificationPath);
const assetSignoffRead = readJsonEvidence(assetSignoffPath);
const uatEvidence = uatEvidenceRead.value;
const backupVerification = backupVerificationRead.value;
const assetSignoff = assetSignoffRead.value;
const assetSignoffValidation = validateAssetSignoff(assetSignoff, assetSignoffRead);

const businessUatComplete = Boolean(
  uatEvidence?.environment?.employeeKeyProvided &&
    uatEvidence?.environment?.allowBillable &&
    uatEvidence?.checks?.employeeModels?.ok === true &&
    uatEvidence?.checks?.billableSmoke?.ok === true
);

const backupRestoreComplete = Boolean(
  backupVerification?.ok === true &&
    backupVerification?.integrity === "ok" &&
    Array.isArray(backupVerification?.missingTables) &&
    backupVerification.missingTables.length === 0
);

const requiredExternalEvidence = [
  {
    id: "business-uat",
    description: "真实员工登录、员工 Key、/v1/models、小额非流式/流式调用、usage 入库和费用核对",
    complete: businessUatComplete,
    evidence: uatEvidencePath || null,
    readError: uatEvidenceRead.error,
  },
  {
    id: "backup-restore",
    description: "生产备份下载到公司受控存储，并在临时环境完成只读校验和恢复演练",
    complete: backupRestoreComplete,
    evidence: backupVerificationPath || null,
    readError: backupVerificationRead.error,
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
process.exitCode = 0;
