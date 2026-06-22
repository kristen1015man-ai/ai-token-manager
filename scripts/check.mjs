import { spawnSync } from "node:child_process";

function pnpmStep(name, args) {
  if (process.platform === "win32") {
    return {
      name,
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm", ...args],
    };
  }
  return { name, command: "pnpm", args };
}

const steps = [
  { name: "handoff gate", command: process.execPath, args: ["scripts/handoff-gate.mjs"] },
  pnpmStep("proxy build", ["--filter", "proxy", "build"]),
  pnpmStep("web build", ["--filter", "web", "build"]),
];

for (const step of steps) {
  console.error(`[check] ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`[check] ${step.name} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
