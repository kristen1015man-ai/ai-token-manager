import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { VerifiedBackupResult, BackupFileInfo } from "./verified-backup";

export type ObjectStorageBackupFile = BackupFileInfo & {
  objectKey: string;
  url: string;
  etag: string | null;
};

export type ObjectStorageBackupResult = {
  enabled: boolean;
  provider: "s3-compatible";
  bucket: string;
  endpoint: string;
  region: string;
  prefix: string;
  backupPrefix: string;
  files: {
    dataDb: ObjectStorageBackupFile;
    usageQueue: ObjectStorageBackupFile;
    usageDeadLetter: ObjectStorageBackupFile;
    manifest: ObjectStorageBackupFile;
  };
};

type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
};

type UploadTarget = {
  label: keyof ObjectStorageBackupResult["files"];
  localPath: string;
  objectName: string;
};

function envEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when BACKUP_OBJECT_STORAGE_ENABLED=true`);
  }
  return value;
}

function getObjectStorageConfig(): ObjectStorageConfig | null {
  if (!envEnabled(process.env.BACKUP_OBJECT_STORAGE_ENABLED)) return null;

  const endpoint = requireEnv("BACKUP_S3_ENDPOINT").replace(/\/+$/g, "");
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "https:") {
    throw new Error("BACKUP_S3_ENDPOINT must use https");
  }

  const bucket = requireEnv("BACKUP_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("BACKUP_S3_BUCKET must be a valid S3 bucket name");
  }

  return {
    endpoint: endpointUrl.toString().replace(/\/+$/g, ""),
    region: process.env.BACKUP_S3_REGION?.trim() || "auto",
    bucket,
    accessKeyId: requireEnv("BACKUP_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("BACKUP_S3_SECRET_ACCESS_KEY"),
    prefix: trimSlashes(process.env.BACKUP_S3_PREFIX || "production"),
  };
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function amzDate(now = new Date()): { dateStamp: string; amzDate: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    dateStamp: iso.slice(0, 8),
    amzDate: iso,
  };
}

function encodeS3Path(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function objectUrl(config: ObjectStorageConfig, objectKey: string): URL {
  return new URL(`/${config.bucket}/${objectKey}`, config.endpoint);
}

function buildAuthorizationHeaders(config: ObjectStorageConfig, url: URL, body: Buffer, contentType: string): Headers {
  const { dateStamp, amzDate: xAmzDate } = amzDate();
  const payloadHash = sha256Hex(body);
  const canonicalUri = encodeS3Path(url.pathname);
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${xAmzDate}`,
    "",
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    xAmzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  return new Headers({
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "Content-Type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": xAmzDate,
  });
}

function fileInfo(filePath: string): BackupFileInfo {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    size: stat.size,
    sha256: sha256Hex(fs.readFileSync(filePath)),
  };
}

async function uploadFile(config: ObjectStorageConfig, objectKey: string, localPath: string): Promise<ObjectStorageBackupFile> {
  const body = fs.readFileSync(localPath);
  const url = objectUrl(config, objectKey);
  const headers = buildAuthorizationHeaders(config, url, body, "application/octet-stream");
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Object storage upload failed for ${objectKey}: ${response.status} ${errorText.slice(0, 300)}`);
  }

  return {
    ...fileInfo(localPath),
    objectKey,
    url: `${config.endpoint}/${config.bucket}/${objectKey}`,
    etag: response.headers.get("etag"),
  };
}

export async function uploadVerifiedBackupToObjectStorage(
  backup: VerifiedBackupResult,
): Promise<ObjectStorageBackupResult | null> {
  const config = getObjectStorageConfig();
  if (!config) return null;

  const backupName = path.basename(backup.backupDir);
  const backupPrefix = trimSlashes(`${config.prefix}/${backupName}`);
  const targets: UploadTarget[] = [
    { label: "dataDb", localPath: backup.files.dataDb.path, objectName: "data.db" },
    { label: "usageQueue", localPath: backup.files.usageQueue.path, objectName: "usage-queue.jsonl" },
    { label: "usageDeadLetter", localPath: backup.files.usageDeadLetter.path, objectName: "usage-dead-letter.jsonl" },
    { label: "manifest", localPath: backup.manifest.path, objectName: "manifest.json" },
  ];

  const uploaded = {} as ObjectStorageBackupResult["files"];
  for (const target of targets) {
    uploaded[target.label] = await uploadFile(config, `${backupPrefix}/${target.objectName}`, target.localPath);
  }

  return {
    enabled: true,
    provider: "s3-compatible",
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: config.prefix,
    backupPrefix,
    files: uploaded,
  };
}
