/**
 * 统一 fetch 封装
 *
 * EP-03/UF-01: 所有前端 API 调用应通过此模块，
 * 确保错误被正确捕获且有统一的结构化处理。
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 类型安全的 fetch 封装
 *
 * - 非 2xx 响应抛出 ApiError
 * - 网络异常抛出原生 Error
 * - 成功返回解析后的 JSON
 */
export async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // 非 JSON 响应，用默认消息
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}
