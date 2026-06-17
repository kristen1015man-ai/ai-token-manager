export type ProviderKeyStatus = "ok" | "invalid" | "unreadable" | "not_configured";

const MASK_RE = /(\*{3,}|•{3,}|●{3,}|﹡{3,}|＊{3,})/;
const PLACEHOLDER_RE = /^(your|demo|test|example|placeholder)[_-]?/i;

export function isMaskedSecret(value: string): boolean {
  return MASK_RE.test(value);
}

export function validateProviderApiKey(provider: string | null | undefined, apiKey: string): string | null {
  const normalizedProvider = provider?.trim().toLowerCase() || "";
  const key = apiKey.trim();

  if (!key) return "API Key 不能为空";
  if (isMaskedSecret(key)) return "API Key 看起来是脱敏值，请重新录入完整明文密钥";
  if (key.startsWith("enc:v1:")) return "API Key 不能提交加密后的存储值，请录入明文密钥";
  if (/\s/.test(key)) return "API Key 不能包含空格或换行";
  if (PLACEHOLDER_RE.test(key)) return "API Key 看起来是示例值，请录入供应商控制台生成的真实密钥";

  if (normalizedProvider === "deepseek" || normalizedProvider === "siliconflow") {
    const label = normalizedProvider === "deepseek" ? "DeepSeek" : "硅基流动";
    if (!key.startsWith("sk-") || key.length < 32) {
      return `${label} API Key 应以 sk- 开头且长度不应过短，请重新录入完整供应商密钥`;
    }
  }

  return null;
}

export function secretStatus(provider: string | null | undefined, apiKey: string | null | undefined): {
  status: ProviderKeyStatus;
  warning: string | null;
} {
  if (!apiKey) return { status: "not_configured", warning: "API Key 未配置" };
  const warning = validateProviderApiKey(provider, apiKey);
  return warning ? { status: "invalid", warning } : { status: "ok", warning: null };
}
