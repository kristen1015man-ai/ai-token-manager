const args = process.argv.slice(2);

function argValue(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = (argValue("--base", process.env.SPARKLOOM_BASE_URL || "https://ai.seapllo.com") || "")
  .replace(/\/+$/, "");
const employeeKey = process.env.SPARKLOOM_EMPLOYEE_API_KEY || "";
const internalKey = process.env.INTERNAL_API_KEY || "";
const allowBillable = hasFlag("--allow-billable");
const includeStream = hasFlag("--include-stream");
const chatModel = argValue("--chat-model", "");

const checks = [];

function record(name, ok, detail = {}) {
  checks.push({ name, ok, detail });
}

async function request(path, options = {}) {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 30_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function checkJsonHealth(path, service) {
  try {
    const result = await request(path);
    record(`${path} health`, result.status === 200 && result.body?.status === "ok" && result.body?.service === service, {
      status: result.status,
      service: result.body?.service,
      expectedService: service,
    });
  } catch (error) {
    record(`${path} health`, false, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function checkPublicBlocked(method, path, expectedStatus = 404) {
  try {
    const result = await request(path, { method });
    record(`${method} ${path} public blocked`, result.status === expectedStatus, {
      status: result.status,
      expectedStatus,
    });
  } catch (error) {
    record(`${method} ${path} public blocked`, false, { error: error instanceof Error ? error.message : String(error) });
  }
}

await checkJsonHealth("/health", "ai-token-proxy");
await checkJsonHealth("/api/health", "sparkloom-web");

await checkPublicBlocked("POST", "/api/internal/admin/backup");
await checkPublicBlocked("GET", "/api/internal/admin/reset-billing");
await checkPublicBlocked("GET", "/api/auth/dev-login");
await checkPublicBlocked("POST", "/api/setup/seed", 403);

if (internalKey) {
  try {
    const result = await request("/api/health", {
      headers: { Authorization: `Bearer ${internalKey}` },
    });
    const checksBody = result.body?.checks || {};
    record("internal detailed health", result.status === 200 &&
      result.body?.status === "ok" &&
      checksBody.dbReadable === true &&
      checksBody.dbWritable === true &&
      checksBody.internalApiKeyConfigured === true &&
      checksBody.encryptionKeyConfigured === true &&
      checksBody.secretDecryption?.ok === true, {
        status: result.status,
        dbReadable: checksBody.dbReadable,
        dbWritable: checksBody.dbWritable,
        secretDecryption: checksBody.secretDecryption,
        users: checksBody.users,
      });
  } catch (error) {
    record("internal detailed health", false, { error: error instanceof Error ? error.message : String(error) });
  }
} else {
  record("internal detailed health", true, { skipped: "INTERNAL_API_KEY not provided" });
}

if (employeeKey) {
  try {
    const result = await request("/v1/models", {
      headers: { Authorization: `Bearer ${employeeKey}` },
    });
    const modelCount = Array.isArray(result.body?.data) ? result.body.data.length : 0;
    record("employee /v1/models", result.status === 200 && modelCount > 0, {
      status: result.status,
      modelCount,
    });
  } catch (error) {
    record("employee /v1/models", false, { error: error instanceof Error ? error.message : String(error) });
  }
} else {
  record("employee /v1/models", true, { skipped: "SPARKLOOM_EMPLOYEE_API_KEY not provided" });
}

if (employeeKey && allowBillable && chatModel) {
  try {
    const result = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${employeeKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        stream: false,
      }),
      timeoutMs: 60_000,
    });
    record("employee billable chat", result.status === 200 && Boolean(result.body?.choices?.[0]) && Boolean(result.body?.usage), {
      status: result.status,
      model: chatModel,
      usagePresent: Boolean(result.body?.usage),
    });
  } catch (error) {
    record("employee billable chat", false, { error: error instanceof Error ? error.message : String(error) });
  }
} else {
  record("employee billable chat", true, {
    skipped: "requires SPARKLOOM_EMPLOYEE_API_KEY plus --allow-billable --chat-model <model>",
  });
}

if (employeeKey && allowBillable && chatModel && includeStream) {
  try {
    const result = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${employeeKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        stream: true,
        stream_options: { include_usage: true },
      }),
      timeoutMs: 60_000,
    });
    const streamText = typeof result.body === "string" ? result.body : "";
    const sawDone = streamText.includes("[DONE]");
    const sawUsage = streamText.includes('"usage"');
    record("employee billable stream chat", result.status === 200 && streamText.includes("data:") && sawDone && sawUsage, {
      status: result.status,
      model: chatModel,
      sawDone,
      sawUsage,
    });
  } catch (error) {
    record("employee billable stream chat", false, { error: error instanceof Error ? error.message : String(error) });
  }
} else {
  record("employee billable stream chat", true, {
    skipped: "requires SPARKLOOM_EMPLOYEE_API_KEY plus --allow-billable --chat-model <model> --include-stream",
  });
}

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({
  ok,
  baseUrl,
  checkedAt: new Date().toISOString(),
  checks,
}, null, 2));

process.exitCode = ok ? 0 : 1;
