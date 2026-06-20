import { execFileSync } from "node:child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function safeGit(args) {
  try {
    return runGit(args);
  } catch (error) {
    return "";
  }
}

const tagName = process.argv[2] || "handoff-2026-06-20";
const headCommit = runGit(["rev-parse", "HEAD"]);
const tagCommit = safeGit(["rev-list", "-n", "1", tagName]);
const tagObject = safeGit(["rev-parse", tagName]);
const branch = safeGit(["branch", "--show-current"]);
const status = runGit(["status", "--short"]);

const result = {
  ok: Boolean(headCommit && tagCommit && headCommit === tagCommit && status === ""),
  branch,
  headCommit,
  tagName,
  tagCommit,
  annotatedTagObject: tagObject && tagObject !== tagCommit ? tagObject : null,
  tagMatchesHead: headCommit === tagCommit,
  workspaceClean: status === "",
  dirtyFiles: status ? status.split(/\r?\n/).filter(Boolean) : [],
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
