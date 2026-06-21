/**
 * AES-256-GCM 加密模块（shared）
 * 用于加密存储敏感字段：channels.apiKey, channels.accessKeySecret, users.apiKey
 *
 * 加密格式：
 * - enc:v1:base64(iv:ciphertext:authTag)，历史格式，直接使用 master key
 * - enc:v2:base64(iv:ciphertext:authTag)，当前格式，通过 HKDF 派生 encryption key
 * 密钥来源：环境变量 ENCRYPTION_KEY（32字节 hex 字符串 或 密码字符串）
 * 搜索 hash：新写入使用 h2:<hex>，通过 HKDF 派生 HMAC key；旧 hex hash 继续兼容读取。
 *
 * 位于 shared/ 以便 proxy 和 web 共同使用
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// 加密前缀，用于区分已加密和明文数据
const ENCRYPTED_PREFIX_V1 = "enc:v1:";
const ENCRYPTED_PREFIX_V2 = "enc:v2:";
const SEARCHABLE_HASH_PREFIX_V2 = "h2:";

/**
 * 从环境变量获取加密密钥
 * ENCRYPTION_KEY 可以是 32 字节 hex（64字符）或任意密码字符串
 * 生产环境必须配置，开发环境允许未配置（不加密）
 */
function getMasterKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;

  // 如果是 64 字符 hex，直接使用
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  // 否则用 scrypt 派生密钥
  return scryptSync(raw, "ai-token-manager-salt-v1", 32);
}

function derivePurposeKey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, "sparkloom-key-derivation-v2", purpose, 32));
}

function getEncryptionKeyV2(): Buffer | null {
  const masterKey = getMasterKey();
  return masterKey ? derivePurposeKey(masterKey, "encryption:aes-256-gcm") : null;
}

function getSearchableHashKeyV2(): Buffer | null {
  const masterKey = getMasterKey();
  return masterKey ? derivePurposeKey(masterKey, "searchable-hmac:sha256") : null;
}

function allowPlaintextSecretsForDev(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_PLAINTEXT_SECRETS_FOR_DEV === "true";
}

function requireEncryptionKey(operation: string): Buffer {
  const key = getMasterKey();
  if (!key) {
    throw new Error(
      `[crypto] ENCRYPTION_KEY is required for ${operation}. ` +
        "Set ENCRYPTION_KEY, or explicitly set ALLOW_PLAINTEXT_SECRETS_FOR_DEV=true for local-only development."
    );
  }
  return key;
}

/**
 * 判断值是否已加密
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX_V1) || value.startsWith(ENCRYPTED_PREFIX_V2);
}

/**
 * 加密一个明文字符串
 * @returns 加密后的字符串（enc:v1:base64），未配置密钥时返回原文
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  let key = getEncryptionKeyV2();
  if (!key) {
    if (allowPlaintextSecretsForDev()) return plaintext;
    key = derivePurposeKey(requireEncryptionKey("encrypting secrets"), "encryption:aes-256-gcm");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // iv + encrypted + authTag 拼接后 base64
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return `${ENCRYPTED_PREFIX_V2}${combined.toString("base64")}`;
}

/**
 * 解密一个加密字符串
 * @returns 解密后的明文，如果未加密则原样返回
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext || !isEncrypted(ciphertext)) return ciphertext;

  const masterKey = getMasterKey();
  if (!masterKey) {
    throw new Error("[crypto] ENCRYPTION_KEY is required to decrypt stored secrets");
  }

  try {
    const isV2 = ciphertext.startsWith(ENCRYPTED_PREFIX_V2);
    const prefix = isV2 ? ENCRYPTED_PREFIX_V2 : ENCRYPTED_PREFIX_V1;
    const key = isV2 ? derivePurposeKey(masterKey, "encryption:aes-256-gcm") : masterKey;
    const combined = Buffer.from(ciphertext.slice(prefix.length), "base64");

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

/**
 * 生成可搜索的 HMAC-SHA256 哈希
 * 用于 API Key 等需要 SQL WHERE 精确匹配的场景
 * 与加密不同：加密用随机 IV（不可搜索），哈希是确定性的（可搜索）
 *
 * 注意：此哈希是单向的，不可逆。用于数据库索引查找，不用于存储原始凭据。
 * 原始凭据仍然用 AES-256-GCM 加密存储，hash 仅作为查找索引。
 */
export function searchableHash(plaintext: string): string {
  const key = getSearchableHashKeyV2();
  const hmacKey = key || (
    allowPlaintextSecretsForDev()
      ? derivePurposeKey(scryptSync("dev-only-searchable-hash", "searchable-hash-salt-v1", 32), "searchable-hmac:sha256")
      : derivePurposeKey(requireEncryptionKey("searchableHash"), "searchable-hmac:sha256")
  );
  return `${SEARCHABLE_HASH_PREFIX_V2}${createHmac("sha256", hmacKey).update(plaintext, "utf8").digest("hex")}`;
}

/**
 * v1 兼容哈希：历史数据直接用 ENCRYPTION_KEY/master key 做 HMAC。
 * 只用于读取旧记录和渐进迁移，不用于新写入。
 */
export function legacySearchableHash(plaintext: string): string {
  const key = getMasterKey();
  const hmacKey = key || (
    allowPlaintextSecretsForDev()
      ? scryptSync("dev-only-searchable-hash", "searchable-hash-salt-v1", 32)
      : requireEncryptionKey("legacy searchableHash")
  );
  return createHmac("sha256", hmacKey).update(plaintext, "utf8").digest("hex");
}

export function searchableHashes(plaintext: string): string[] {
  const next = searchableHash(plaintext);
  const legacy = legacySearchableHash(plaintext);
  return next === legacy ? [next] : [next, legacy];
}
