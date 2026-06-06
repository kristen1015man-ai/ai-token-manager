/**
 * AES-256-GCM 加密模块（shared）
 * 用于加密存储敏感字段：channels.apiKey, channels.accessKeySecret, users.apiKey
 *
 * 加密格式：enc:v1:base64(iv:ciphertext:authTag)，16字节IV + 密文 + 16字节Tag
 * 密钥来源：环境变量 ENCRYPTION_KEY（32字节 hex 字符串 或 密码字符串）
 *
 * 位于 shared/ 以便 proxy 和 web 共同使用
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// 加密前缀，用于区分已加密和明文数据
const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * 从环境变量获取加密密钥
 * ENCRYPTION_KEY 可以是 32 字节 hex（64字符）或任意密码字符串
 * 生产环境必须配置，开发环境允许未配置（不加密）
 */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;

  // 如果是 64 字符 hex，直接使用
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  // 否则用 scrypt 派生密钥
  return scryptSync(raw, "ai-token-manager-salt-v1", 32);
}

/**
 * 判断值是否已加密
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * 加密一个明文字符串
 * @returns 加密后的字符串（enc:v1:base64），未配置密钥时返回原文
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getEncryptionKey();
  if (!key) return plaintext; // 未配置密钥，不加密

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // iv + encrypted + authTag 拼接后 base64
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return `${ENCRYPTED_PREFIX}${combined.toString("base64")}`;
}

/**
 * 解密一个加密字符串
 * @returns 解密后的明文，如果未加密则原样返回
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext || !isEncrypted(ciphertext)) return ciphertext;

  const key = getEncryptionKey();
  if (!key) {
    // 有加密数据但没密钥 — 不应该发生
    console.error("[crypto] 数据已加密但 ENCRYPTION_KEY 未配置，无法解密");
    return ciphertext;
  }

  try {
    const combined = Buffer.from(ciphertext.slice(ENCRYPTED_PREFIX.length), "base64");

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(combined.length - TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (e) {
    console.error("[crypto] 解密失败:", e);
    return ciphertext;
  }
}

/**
 * 智能加密：如果值已经加密则不重复加密，如果值是明文则加密
 * 用于写入前的统一处理
 */
export function ensureEncrypted(value: string): string {
  if (!value || isEncrypted(value)) return value;
  return encrypt(value);
}

/**
 * 智能解密：如果值已加密则解密，否则原样返回
 * 用于读取后的统一处理
 */
export function ensureDecrypted(value: string): string {
  return decrypt(value);
}

/**
 * 时序安全字符串比较，防止时序攻击
 * 用于 API Key 验证等安全敏感场景
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // 长度不同时，仍然做比较以保持恒定时间
  // 但结果一定为 false
  if (bufA.length !== bufB.length) {
    // 用相同长度的比较消耗时间，避免长度泄露信息
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
