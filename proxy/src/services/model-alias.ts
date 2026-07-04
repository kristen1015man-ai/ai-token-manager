export function toClaudeGatewayModelId(model: string): string {
  const normalized = model.trim();
  if (/^(claude|anthropic)[\w.-]*/i.test(normalized)) return normalized;
  return `claude-sparkloom-${normalized}`;
}

export function fromClaudeGatewayModelId(model: string): string {
  return model.startsWith("claude-sparkloom-")
    ? model.slice("claude-sparkloom-".length)
    : model;
}

export function displayNameForModel(model: string): string {
  return model
    .split(/[-_:]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
