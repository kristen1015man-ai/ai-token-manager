/**
 * Legacy fallback model list.
 *
 * Pricing is calculated by the web service when usage is persisted. The proxy
 * keeps this tiny module only as a defensive fallback for older imports.
 */

const FALLBACK_MODELS = [
  "deepseek-chat",
  "deepseek-reasoner",
];

export function invalidatePriceCache(): void {
  // Pricing cache now lives in web.
}

export async function getKnownModels(): Promise<string[]> {
  return FALLBACK_MODELS;
}
