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

function readJson(filePath) {
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function git(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
}

const uatEvidencePath = argValue("--uat-evidence");
const backupVerificationPath = argValue("--backup-verification");
const assetSignoffPath = argValue("--asset-signoff");

const handoffStatus = runJson(process.execPath, ["scripts/handoff-status.mjs", "handoff-2026-06-20"]);
const uatEvidence = readJson(uatEvidencePath);
const backupVerification = readJson(backupVerificationPath);
const assetSignoffExists = assetSignoffPath ? fs.existsSync(path.resolve(assetSignoffPath)) : false;

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
  },
  {
    id: "backup-restore",
    description: "生产备份下载到公司受控存储，并在临时环境完成只读校验和恢复演练",
    complete: backupRestoreComplete,
    evidence: backupVerificationPath || null,
  },
  {
    id: "asset-handoff",
    description: "Railway、DNS、飞书应用、供应商账号、通知群、备份存储 owner 和权限交割记录",
    complete: assetSignoffExists,
    evidence: assetSignoffPath || null,
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
