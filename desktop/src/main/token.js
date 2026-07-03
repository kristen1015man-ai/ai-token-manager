"use strict";
// 本地 agent-token 管理。
// 复用现有 ~/.sparkloom/agent-token 文件（与 sparkloom-windows.ps1 的 Ensure-Agent-Token、
// start-macos.sh 格式互通），保证桌面端和旧 zip 分发方式可混用。

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

function configDir() {
  const override = process.env.SPARKLOOM_CONFIG_HOME;
  return override ? path.resolve(override) : path.join(os.homedir(), ".sparkloom");
}

function tokenFile() {
  return path.join(configDir(), "agent-token");
}

function ensureToken() {
  fs.mkdirSync(configDir(), { recursive: true });
  try {
    const existing = fs.readFileSync(tokenFile(), "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (_) {
    // 文件不存在或不可读，走新建
  }
  // base64url(32 bytes) = 43 字符，兼容现有 token 格式
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(tokenFile(), token, { mode: 0o600 });
  return token;
}

module.exports = { ensureToken, configDir, tokenFile };
