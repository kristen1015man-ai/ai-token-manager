type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: {
    status?: unknown;
    statusText?: unknown;
    data?: unknown;
  };
};

export function safeErrorSummary(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const err = error as ErrorLike;
  return {
    name: typeof err.name === "string" ? err.name : undefined,
    message: typeof err.message === "string" ? err.message : undefined,
    code: typeof err.code === "string" || typeof err.code === "number" ? err.code : undefined,
    status: typeof err.status === "number" ? err.status : undefined,
    responseStatus: typeof err.response?.status === "number" ? err.response.status : undefined,
    responseStatusText: typeof err.response?.statusText === "string" ? err.response.statusText : undefined,
    responseData: summarizeResponseData(err.response?.data),
  };
}

function summarizeResponseData(data: unknown): unknown {
  if (!data) return undefined;
  if (typeof data === "string") return data.slice(0, 300);
  if (typeof data !== "object") return data;

  const value = data as Record<string, unknown>;
  return {
    code: value.code,
    msg: value.msg ?? value.message,
    error: value.error,
  };
}
