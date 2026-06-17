"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";

interface UserKey {
  id: string;
  maskedKey: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface KeyResponse {
  keys: UserKey[];
  maskedKey?: string;
  proxyUrl: string;
}

interface CreateKeyResponse extends KeyResponse {
  apiKey: string;
}

function formatTime(value: number | null): string {
  if (!value) return "从未使用";
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export default function KeyManager() {
  const [keys, setKeys] = useState<UserKey[]>([]);
  const [proxyUrl, setProxyUrl] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [oneTimeNotice, setOneTimeNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canDelete = keys.length > 1;
  const newestKeyId = useMemo(() => keys[keys.length - 1]?.id || "", [keys]);
  const anthropicUrl = proxyUrl ? `${proxyUrl.replace(/\/v1\/?$/, "")}/anthropic` : "https://ai.seapllo.com/anthropic";

  useEffect(() => {
    fetchApi<KeyResponse>("/api/user/key")
      .then((data) => {
        setKeys(data.keys || []);
        setProxyUrl(data.proxyUrl || "");
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    if (label === "key") {
      setCreatedKey(null);
      setOneTimeNotice("密钥已复制并隐藏。出于安全原因，后续不能再次查看或复制明文。");
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const data = await fetchApi<CreateKeyResponse>("/api/user/key", { method: "POST" });
      setKeys(data.keys || []);
      setProxyUrl(data.proxyUrl || "");
      setCreatedKey(data.apiKey);
      setOneTimeNotice(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "新建失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(key: UserKey) {
    if (!canDelete) return;
    if (!confirm("确定删除这个密钥吗？正在使用它的客户端会立即无法连接。")) return;

    setDeletingId(key.id);
    setError(null);
    try {
      const data = await fetchApi<KeyResponse>("/api/user/key", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id }),
      });
      setKeys(data.keys || []);
      setProxyUrl(data.proxyUrl || proxyUrl);
      if (createdKey && key.maskedKey.endsWith(createdKey.slice(-4))) {
        setCreatedKey(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败，请稍后重试");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="animate-pulse p-6">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="glass-card-static p-3 text-sm text-red-600 bg-red-50/70">
          {error}
        </div>
      )}

      {oneTimeNotice && (
        <div className="glass-card-static p-3 text-sm text-emerald-700 bg-emerald-50/70">
          {oneTimeNotice}
        </div>
      )}

      {createdKey && (
        <div className="glass-card-static p-6 border-emerald-200/60 bg-emerald-50/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-gray-900">新密钥</h3>
              <p className="mt-1 text-sm text-gray-500">
                明文只显示一次。复制后或离开当前页面后，将不能再次查看明文。
              </p>
            </div>
            <button
              onClick={() => {
                setCreatedKey(null);
              }}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-white/60"
            >
              隐藏
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-emerald-200 bg-white/70 p-4 font-mono text-sm text-gray-800">
            <div className="break-all">{createdKey}</div>
            <button
              onClick={() => copyToClipboard(createdKey, "key")}
              className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              复制一次
            </button>
          </div>
        </div>
      )}

      <div className="glass-card-static p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">员工接口密钥</h3>
            <p className="mt-1 text-sm text-gray-500">
              已创建的密钥只显示脱敏结果。需要新的明文密钥时，请重新新建。
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
          >
            {creating ? "正在新建..." : "新建密钥"}
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-gray-100 bg-white/60">
          {keys.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">当前没有密钥。请先新建密钥，再配置客户端。</div>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 border-b border-gray-100 p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-800 break-all">{key.maskedKey}</span>
                    {key.id === newestKeyId && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">最新</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    创建时间：{formatTime(key.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(key)}
                  disabled={!canDelete || deletingId === key.id}
                  className="self-start rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
                  title={!canDelete ? "至少需要保留一个密钥" : "删除密钥"}
                >
                  {deletingId === key.id ? "正在删除..." : "删除"}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 rounded-xl border border-gray-100 bg-white/50 p-4 text-sm text-gray-600">
          <div className="font-medium text-gray-900">Claude Code 域名</div>
          <div className="mt-2 break-all font-mono text-gray-800">{anthropicUrl}</div>
          <div className="mt-2 text-xs text-gray-500">
            在 Claude Code 中填入 <span className="font-mono text-gray-700">ANTHROPIC_BASE_URL</span>。
          </div>
        </div>
      </div>
    </div>
  );
}
