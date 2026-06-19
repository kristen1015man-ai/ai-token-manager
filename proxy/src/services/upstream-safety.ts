import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const allowInsecureUpstreams =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_UPSTREAMS === "true";
const allowPrivateUpstreams =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_PRIVATE_UPSTREAMS === "true";
const DEFAULT_PRODUCTION_ALLOWED_HOSTS = [
  "api.deepseek.com",
  "api.siliconflow.cn",
  "open.bigmodel.cn",
  "api.openai.com",
  "api.anthropic.com",
];

interface SafetyCacheEntry {
  expiresAt: number;
  addresses: string[];
}

const dnsCache = new Map<string, SafetyCacheEntry>();

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) {
    return true;
  }
  const mappedIpv4 = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254"
  );
}

function allowedUpstreamHosts(): Set<string> {
  const configured = (process.env.UPSTREAM_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : DEFAULT_PRODUCTION_ALLOWED_HOSTS);
}

function assertAllowedProductionHostname(hostname: string): void {
  if (process.env.NODE_ENV !== "production") return;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!allowedUpstreamHosts().has(host)) {
    throw new Error(`Unsafe upstream URL: host '${host}' is not in UPSTREAM_ALLOWED_HOSTS`);
  }
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function resolveHost(hostname: string): Promise<string[]> {
  const cached = dnsCache.get(hostname);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.addresses;

  const records = await lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((record) => record.address);
  dnsCache.set(hostname, { addresses, expiresAt: now + DNS_CACHE_TTL_MS });
  return addresses;
}

export async function assertSafeUpstreamBaseUrl(rawBaseUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error("Unsafe upstream URL: invalid URL");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Unsafe upstream URL: protocol must be https");
  }
  if (parsed.protocol !== "https:" && !allowInsecureUpstreams) {
    throw new Error("Unsafe upstream URL: production upstreams must use https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Unsafe upstream URL: credentials are not allowed in URL");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) {
    throw new Error("Unsafe upstream URL: local/metadata host is blocked");
  }
  assertAllowedProductionHostname(hostname);

  const directIpFamily = isIP(hostname);
  if (directIpFamily) {
    if (!allowPrivateUpstreams && isPrivateAddress(hostname)) {
      throw new Error("Unsafe upstream URL: private IP is blocked");
    }
    return parsed;
  }

  if (process.env.NODE_ENV === "production" && !hostname.includes(".")) {
    throw new Error("Unsafe upstream URL: production hostname must be a public FQDN");
  }

  const addresses = await resolveHost(hostname);
  if (addresses.length === 0) {
    throw new Error("Unsafe upstream URL: DNS lookup returned no addresses");
  }
  if (!allowPrivateUpstreams && addresses.some((address) => isPrivateAddress(address))) {
    throw new Error("Unsafe upstream URL: DNS resolves to private address");
  }

  return parsed;
}
