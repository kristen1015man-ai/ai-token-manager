"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../../../lib/fetcher";
import EmptyState from "@/components/EmptyState";
import { type Channel, type ChannelFormState, PROVIDERS, EMPTY } from "./channel-types";
import { isAuto, getBalanceDisplay, getBalanceStatus, formatSyncTime } from "./channel-helpers";
import ChannelForm from "./ChannelForm";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ChannelFormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingChannel, setSyncingChannel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const load = () => {
    fetchApi<{ channels: Channel[] }>("/api/admin/channels")
      .then((d) => setChannels(d.channels || []))
      .catch((err) => showToast(err instanceof ApiError ? err.message : "加载渠道失败"));
  };
  useEffect(load, []);

  const handleSubmit = async () => {
    const modelsArr = JSON.parse(form.models);
    const payload: Record<string, unknown> = {
      ...form,
      models: modelsArr,
      currency: form.currency || "CNY",
      provider: form.provider || null,
    };
    // AK/SK 留空不传（避免覆盖已有值）
    if (!form.accessKeyId) delete payload.accessKeyId;
    if (!form.accessKeySecret) delete payload.accessKeySecret;
    try {
      if (editingId) {
        await fetchApi("/api/admin/channels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
      } else {
        await fetchApi("/api/admin/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "操作失败");
    }
  };

  const handleToggle = async (ch: Channel) => {
    try {
      await fetchApi("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ch.id, status: ch.status === "active" ? "disabled" : "active" }),
      });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "状态切换失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此渠道吗？")) return;
    try {
      await fetchApi("/api/admin/channels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const startEdit = (ch: Channel) => {
    const modelsStr = Array.isArray(ch.models) ? JSON.stringify(ch.models) : ch.models;
    setForm({
      name: ch.name,
      baseUrl: ch.baseUrl,
      apiKey: "",
      models: modelsStr,
      priority: ch.priority,
      status: ch.status,
      currency: ch.currency || "CNY",
      provider: ch.provider || "",
      accessKeyId: ch.accessKeyId || "",
      accessKeySecret: "",
    });
    setEditingId(ch.id);
    setShowForm(true);
  };

  /** 同步所有渠道余额 */
  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const result = await fetchApi<{ synced?: number; failed?: number; alerts?: unknown[] }>("/api/admin/channels/balance-sync", { method: "POST" });
      if ((result.synced ?? 0) > 0 || (result.failed ?? 0) > 0) {
        alert(`同步完成：成功 ${result.synced ?? 0} 个，失败 ${result.failed ?? 0} 个` + (result.alerts?.length ? `\n⚠️ ${result.alerts.length} 个渠道余额低于阈值` : ""));
      }
      load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "同步失败，请检查网络");
    } finally {
      setSyncing(false);
    }
  };

  /** 同步单个渠道余额 */
  const handleSyncOne = async (ch: Channel) => {
    setSyncingChannel(ch.id);
    try {
      const result = await fetchApi<{ synced?: number; failed?: number; alerts?: unknown[] }>("/api/admin/channels/balance-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: ch.id }),
      });
      if ((result.failed ?? 0) > 0) {
        alert(`${ch.name} 余额同步失败`);
      }
      load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "同步失败");
    } finally {
      setSyncingChannel(null);
    }
  };

  /** 手动更新余额 */
  const handleManualBalance = async (ch: Channel, balance: string) => {
    const val = parseFloat(balance);
    if (isNaN(val)) return;
    try {
      await fetchApi("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: ch.id,
          balance: val,
          balanceCurrency: ch.currency || "CNY",
        }),
      });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "余额更新失败");
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="rounded-xl p-3 text-sm text-red-600 flex items-center justify-between bg-red-50/70 border border-red-200 backdrop-blur-sm">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">上游 API 渠道</h3>
        <div className="flex gap-2">
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="px-4 py-2 text-sm rounded-xl font-medium transition-all duration-200 disabled:opacity-50 bg-indigo-50/50 text-indigo-600 border border-indigo-200/50"
          >
            {syncing ? "🔄 同步中..." : "🔄 同步所有余额"}
          </button>
          <button
            onClick={() => { setForm(EMPTY); setEditingId(null); setShowForm(!showForm); }}
            className="glass-btn text-sm"
          >
            {showForm ? "取消" : "+ 添加渠道"}
          </button>
        </div>
      </div>

      {showForm && (
        <ChannelForm form={form} setForm={setForm} editingId={editingId} onSubmit={handleSubmit} />
      )}

      <div className="glass-card-static p-5">
        {channels.length === 0 ? (
          <EmptyState icon="" message="暂无渠道，请添加" />
        ) : (
          <div className="overflow-x-auto">
            <table className="glass-table">
              <thead>
                <tr>
                  <th className="text-left py-2 font-medium">名称</th>
                  <th className="text-left py-2 font-medium">Base URL</th>
                  <th className="text-left py-2 font-medium">模型</th>
                  <th className="text-center py-2 font-medium">币种</th>
                  <th className="text-center py-2 font-medium">供应商</th>
                  <th className="text-center py-2 font-medium">余额</th>
                  <th className="text-center py-2 font-medium">优先级</th>
                  <th className="text-center py-2 font-medium">状态</th>
                  <th className="text-right py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => {
                  const auto = isAuto(ch);
                  const balanceDisplay = getBalanceDisplay(ch);
                  const balanceStatus = getBalanceStatus(ch);
                  const syncTime = formatSyncTime(ch.balanceSyncedAt);

                  return (
                    <tr key={ch.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-800 whitespace-nowrap">{ch.name}</td>
                      <td className="py-2 text-gray-600 text-xs font-mono max-w-[200px] truncate">{ch.baseUrl}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1 max-w-[250px]">
                          {(Array.isArray(ch.models) ? ch.models : JSON.parse(ch.models || "[]")).map((m: string) => (
                            <span key={m} className="inline-block px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs">{m}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          (ch.currency || "CNY") === "USD"
                            ? "bg-sky-50 text-sky-600"
                            : "bg-green-50 text-green-600"
                        }`}>
                          {ch.currency || "CNY"}
                        </span>
                      </td>
                      <td className="py-2 text-center">
                        {ch.provider ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-600">
                            {PROVIDERS.find((p) => p.value === ch.provider)?.label || ch.provider}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      {/* 余额列 */}
                      <td className="py-2 text-center">
                        {balanceDisplay ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`font-medium text-sm ${
                              balanceStatus === "danger" ? "text-red-600" :
                              balanceStatus === "warning" ? "text-amber-600" :
                              "text-green-600"
                            }`}>
                              {balanceDisplay}
                            </span>
                            {balanceStatus === "danger" && (
                              <span className="px-1.5 py-0 rounded-full text-[10px] bg-red-50 text-red-500">⚠ 余额严重不足</span>
                            )}
                            {balanceStatus === "warning" && (
                              <span className="px-1.5 py-0 rounded-full text-[10px] bg-amber-50 text-amber-500">⚠ 余额偏低</span>
                            )}
                            {syncTime && (
                              <span className="text-[10px] text-gray-300">更新于 {syncTime}</span>
                            )}
                          </div>
                        ) : auto ? (
                          <span className="text-xs text-gray-300">待同步</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              placeholder="手动填写"
                              className="w-20 px-2 py-1 border border-gray-200 rounded text-xs text-center"
                              onBlur={(e) => { if (e.target.value) handleManualBalance(ch, e.target.value); }}
                              onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLInputElement).value) handleManualBalance(ch, (e.target as HTMLInputElement).value); }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-center text-gray-600">{ch.priority}</td>
                      <td className="py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${ch.status === "active" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                          {ch.status === "active" ? "启用" : "禁用"}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2 flex-nowrap">
                          {auto && (
                            <button
                              onClick={() => handleSyncOne(ch)}
                              disabled={syncingChannel === ch.id}
                              className="text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-50 whitespace-nowrap"
                              title="刷新余额"
                            >
                              {syncingChannel === ch.id ? "⏳" : "🔄"}
                            </button>
                          )}
                          <button onClick={() => handleToggle(ch)} className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap">
                            {ch.status === "active" ? "禁用" : "启用"}
                          </button>
                          <button onClick={() => startEdit(ch)} className="text-xs text-indigo-500 hover:text-indigo-700 whitespace-nowrap">编辑</button>
                          <button onClick={() => handleDelete(ch.id)} className="text-xs text-red-400 hover:text-red-600 whitespace-nowrap">删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <p>💡 DeepSeek、硅基流动、阿里千问 支持自动同步余额，点击 🔄 刷新</p>
        <p>💡 OpenAI / Anthropic / GLM 没有余额 API，请在余额列手动填写</p>
        <p>💡 阿里千问需配置 AccessKey ID/Secret（通过阿里云 BSS API 查询余额）</p>
        <p>💡 设置供应商后，价格同步会自动将官方价格绑定到该渠道</p>
      </div>
    </div>
  );
}
