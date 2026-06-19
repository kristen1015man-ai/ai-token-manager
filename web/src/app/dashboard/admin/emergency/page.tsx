"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import PageLoader from "@/components/PageLoader";
import { ApiError, fetchApi } from "@/lib/fetcher";

interface UserKey {
  id: string;
  maskedKey: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface KeyUser {
  id: string;
  name: string;
  email: string;
  department: string;
  status: string;
  feishuId: string;
  keyCount: number;
  keys?: UserKey[];
}

interface StatusUser {
  id: string;
  name: string;
  email: string;
  department: string;
  status: string;
  role: string;
  feishuId: string;
  updatedAt: number;
}

function formatTime(value: number | null): string {
  if (!value) return "从未使用";
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export default function EmergencyPage() {
  const [statusUsers, setStatusUsers] = useState<StatusUser[]>([]);
  const [keyUsers, setKeyUsers] = useState<KeyUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<KeyUser | null>(null);
  const [statusQuery, setStatusQuery] = useState("");
  const [keyQuery, setKeyQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStatusUsers(query = statusQuery) {
    const params = new URLSearchParams({ status: "disabled" });
    if (query.trim()) params.set("query", query.trim());
    const data = await fetchApi<{ users: StatusUser[] }>(`/api/admin/users/status?${params.toString()}`);
    setStatusUsers(data.users || []);
  }

  async function loadKeyUsers(query = keyQuery) {
    const params = new URLSearchParams({ includeDisabled: "true" });
    if (query.trim()) params.set("query", query.trim());
    const data = await fetchApi<{ users: KeyUser[] }>(`/api/admin/user-keys?${params.toString()}`);
    setKeyUsers(data.users || []);
  }

  async function loadSelectedUser(userId: string) {
    const params = new URLSearchParams({ userId, includeDisabled: "true" });
    const data = await fetchApi<{ users: KeyUser[] }>(`/api/admin/user-keys?${params.toString()}`);
    setSelectedUser(data.users?.[0] || null);
  }

  async function refreshAll() {
    setError(null);
    try {
      await Promise.all([loadStatusUsers(), loadKeyUsers()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateUserStatus(user: StatusUser | KeyUser, status: "active" | "disabled") {
    const reason = prompt(status === "active" ? "请输入恢复原因" : "请输入停用原因");
    if (!reason) return;
    setBusy(`status-${user.id}`);
    setError(null);
    try {
      await fetchApi("/api/admin/users/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, status, reason }),
      });
      await refreshAll();
      if (selectedUser?.id === user.id) await loadSelectedUser(user.id);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "状态更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function revokeKey(user: KeyUser, key: UserKey) {
    const reason = prompt(`请输入吊销 ${user.name} 这个密钥的原因`);
    if (!reason) return;
    if (!confirm(`确定吊销 ${user.name} 的密钥 ${key.maskedKey}？正在使用它的客户端会立即失效。`)) return;
    setBusy(`key-${key.id}`);
    setError(null);
    try {
      await fetchApi("/api/admin/user-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, keyId: key.id, reason }),
      });
      await loadSelectedUser(user.id);
      await loadKeyUsers();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "吊销失败");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">员工应急</h3>
        <button
          onClick={refreshAll}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-white/70"
        >
          刷新
        </button>
      </div>

      {error && (
        <div className="glass-card-static border-red-100 bg-red-50/70 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <section className="glass-card-static p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium text-gray-900">停用用户恢复</div>
            <div className="mt-1 text-xs text-gray-500">用于处理飞书同步误停用或应急恢复。</div>
          </div>
          <div className="flex gap-2">
            <input
              value={statusQuery}
              onChange={(e) => setStatusQuery(e.target.value)}
              placeholder="搜索姓名、邮箱、飞书 ID"
              className="glass-input w-56 text-sm"
            />
            <button
              onClick={() => loadStatusUsers(statusQuery).catch((err) => setError(err instanceof ApiError ? err.message : "搜索失败"))}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              搜索
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white/60">
          {statusUsers.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">没有匹配的停用用户。</div>
          ) : (
            statusUsers.map((user) => (
              <div key={user.id} className="flex flex-col gap-3 border-b border-gray-100 p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={user.name} size="sm" />
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{user.name}</div>
                    <div className="truncate text-xs text-gray-500">{user.department || "未分配"} · {user.email || user.feishuId}</div>
                  </div>
                </div>
                <button
                  onClick={() => updateUserStatus(user, "active")}
                  disabled={busy === `status-${user.id}`}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  恢复 active
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="glass-card-static p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium text-gray-900">员工 Key 应急吊销</div>
            <div className="mt-1 text-xs text-gray-500">只显示脱敏 Key；吊销最后一个 Key 后，员工需登录重新新建。</div>
          </div>
          <div className="flex gap-2">
            <input
              value={keyQuery}
              onChange={(e) => setKeyQuery(e.target.value)}
              placeholder="搜索姓名、邮箱、飞书 ID"
              className="glass-input w-56 text-sm"
            />
            <button
              onClick={() => loadKeyUsers(keyQuery).catch((err) => setError(err instanceof ApiError ? err.message : "搜索失败"))}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              搜索
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-gray-100 bg-white/60">
            {keyUsers.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">没有匹配用户。</div>
            ) : (
              keyUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => loadSelectedUser(user.id)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 p-3 text-left last:border-b-0 hover:bg-gray-50 ${
                    selectedUser?.id === user.id ? "bg-gray-50" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{user.name}</div>
                    <div className="truncate text-xs text-gray-500">{user.department || "未分配"} · {user.email || user.feishuId}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${user.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {user.keyCount} 个
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-white/60">
            {!selectedUser ? (
              <div className="p-4 text-sm text-gray-500">选择一个员工查看密钥。</div>
            ) : (
              <div>
                <div className="border-b border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">{selectedUser.name}</div>
                      <div className="mt-1 text-xs text-gray-500">{selectedUser.department || "未分配"} · {selectedUser.status}</div>
                    </div>
                    {selectedUser.status === "active" ? (
                      <button
                        onClick={() => updateUserStatus(selectedUser, "disabled")}
                        disabled={busy === `status-${selectedUser.id}`}
                        className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        停用账号
                      </button>
                    ) : (
                      <button
                        onClick={() => updateUserStatus(selectedUser, "active")}
                        disabled={busy === `status-${selectedUser.id}`}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        恢复账号
                      </button>
                    )}
                  </div>
                </div>

                {selectedUser.keys?.length ? (
                  selectedUser.keys.map((key) => (
                    <div key={key.id} className="flex flex-col gap-3 border-b border-gray-100 p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="break-all font-mono text-sm text-gray-800">{key.maskedKey}</div>
                        <div className="mt-1 text-xs text-gray-400">
                          创建：{formatTime(key.createdAt)} · 最近使用：{formatTime(key.lastUsedAt)}
                        </div>
                      </div>
                      <button
                        onClick={() => revokeKey(selectedUser, key)}
                        disabled={busy === `key-${key.id}`}
                        className="self-start rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 sm:self-auto"
                      >
                        吊销
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-sm text-gray-500">该员工当前没有可用 Key。</div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
