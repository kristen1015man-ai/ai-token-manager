import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function argValue(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = (argValue("--base", process.env.SPARKLOOM_BASE_URL || "https://ai.seapllo.com") || "")
  .replace(/\/+$/, "");
const tagName = argValue("--tag", "handoff-2026-06-20");
const chatModel = argValue("--chat-model", "");
const outPath = argValue("--out", "");
const allowBillable = hasFlag("--allow-billable");
const includeStream = hasFlag("--include-stream");
const employeeKeyProvided = Boolean(process.env.SPARKLOOM_EMPLOYEE_API_KEY);
const internalKeyProvided = Boolean(process.env.INTERNAL_API_KEY);

const secretPatterns = [
  /sk-emp-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  /cli_[A-Za-z0-9]{12,}/g,
];

function redactText(value) {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

function sanitize(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
}

function runNode(script, scriptArgs = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = result.stdout || "";
  const stderr = result.stderr || "";
  try {
    return {
      ...sanitize(JSON.parse(output)),
      exitCode: result.status,
      stderr: stderr ? redactText(stderr) : undefined,
    };
  } catch {
    return {
      ok: result.status === 0,
      exitCode: result.status,
      raw: redactText(output),
      stderr: stderr ? redactText(stderr) : undefined,
    };
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
}

function smokeCheckOk(smokeResult, name) {
  if (!Array.isArray(smokeResult?.checks)) return false;
  return smokeResult.checks.some((check) => check?.name === name && check?.ok === true);
}

const generatedAt = new Date().toISOString();
const evidence = {
  ok: false,
  formalBusinessUatComplete: false,
  generatedAt,
  baseUrl,
  tagName,
  environment: {
    employeeKeyProvided,
    internalKeyProvided,
    allowBillable,
    includeStream,
    chatModel: chatModel || null,
  },
  local: {
    branch: git(["branch", "--show-current"]),
    head: git(["rev-parse", "HEAD"]),
    statusShort: git(["status", "--short"]),
  },
  checks: {},
};

try {
  evidence.checks.handoffStatus = runNode("scripts/handoff-status.mjs", [tagName]);
  evidence.checks.publicSmoke = runNode("scripts/production-smoke.mjs", ["--base", baseUrl], {
    SPARKLOOM_EMPLOYEE_API_KEY: "",
    INTERNAL_API_KEY: "",
  });

  if (employeeKeyProvided) {
    evidence.checks.employeeModels = runNode("scripts/production-smoke.mjs", ["--base", baseUrl]);
  } else {
    evidence.checks.employeeModels = {
      ok: true,
      skipped: "SPARKLOOM_EMPLOYEE_API_KEY not provided",
    };
  }

  if (employeeKeyProvided && allowBillable && chatModel) {
    const billableArgs = ["--base", baseUrl, "--allow-billable", "--chat-model", chatModel];
    if (includeStream) billableArgs.push("--include-stream");
    evidence.checks.billableSmoke = runNode("scripts/production-smoke.mjs", billableArgs);
  } else {
    evidence.checks.billableSmoke = {
      ok: true,
      skipped: "requires SPARKLOOM_EMPLOYEE_API_KEY plus --allow-billable --chat-model <model>",
    };
  }

  evidence.ok = Object.values(evidence.checks).every((check) => check?.ok === true);
  evidence.formalBusinessUatComplete = Boolean(
    employeeKeyProvided &&
      allowBillable &&
      includeStream &&
      chatModel &&
      evidence.checks.employeeModels?.ok === true &&
      evidence.checks.billableSmoke?.ok === true &&
      smokeCheckOk(evidence.checks.billableSmoke, "employee billable chat") &&
      smokeCheckOk(evidence.checks.billableSmoke, "employee billable stream chat")
  );
} catch (error) {
  evidence.error = redactText(error instanceof Error ? error.message : String(error));
}

const json = `${JSON.stringify(sanitize(evidence), null, 2)}\n`;

if (outPath) {
  const target = path.resolve(outPath);
  const shouldUseDirectory =
    (fs.existsSync(target) && fs.statSync(target).isDirectory()) ||
    (!fs.existsSync(target) && !path.extname(target));
  const targetFile = shouldUseDirectory
    ? path.join(target, `handoff-uat-evidence-${generatedAt.replace(/[:.]/g, "-")}.json`)
    : target;
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, json, "utf8");
  console.error(`Wrote sanitized handoff evidence to ${targetFile}`);
}

process.stdout.write(json);
process.exitCode = evidence.ok ? 0 : 1;
