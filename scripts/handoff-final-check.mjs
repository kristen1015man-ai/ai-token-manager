import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function runJson(name, commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch {
    parsed = {
      raw: result.stdout || "",
    };
  }
  return {
    name,
    ok: result.status === 0,
    exitCode: result.status,
    stderr: result.stderr || undefined,
    output: parsed,
  };
}

function runText(name, commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    name,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || undefined,
  };
}

const gate = runText("handoff gate", ["scripts/handoff-gate.mjs"]);
const status = runJson("handoff status", ["scripts/handoff-status.mjs", "handoff-2026-06-20"]);
const readiness = runJson("handoff readiness", [
  "scripts/handoff-readiness-report.mjs",
  "--require-formal",
  ...args,
]);

const report = {
  ok: gate.ok && status.ok && readiness.ok && readiness.output?.formalSignoffReady === true,
  generatedAt: new Date().toISOString(),
  checks: {
    gate,
    status,
    readiness,
  },
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
