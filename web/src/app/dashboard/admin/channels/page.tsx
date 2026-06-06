"use client";

import { useEffect, useState } from "react";

interface Channel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string | string[];
  priority: number;
  status: string;
  currency: string;
  provider: string | null;
  createdAt: string;
  balance: number | null;
  balanceCurrency: string | null;
  balanceSyncMode: string | null;
  balanceSyncedAt: string | null;
  balanceAlertThreshold: number | null;
  accessKeyId: string | null;
  accessKeySecret: string | null;
}

const PROVIDERS = [
  { value: "", label: "无（手动管理）" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "glm", label: "智谱 GLM" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "siliconflow", label: "硅基流动" },
  { value: "alibaba", label: "阿里千问" },
];

const AUTO_PROVIDERS = ["deepseek", "siliconflow", "alibaba"];

const EMPTY = {
  name: "",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  models: '["deepseek-chat"]',
  priority: 0,
  status: "active",
  currency: "CNY",
  provider: "",
  accessKeyId: "",
  accessKeySecret: "",
};

const DEFAULT_THRESHOLDS: Record<string, number> = { CNY: 100, USD: 10 };

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingChannel, setSyncingChannel] = useState<string | null>(null);
  const [editBalance, setEditBalance] = useState<string>("");
  const [editThreshold, setEditThreshold] = useState<string>("");

  const load = () => {
    fetch("/api/admin/channels").then((r) => r.ok ? r.json() : null).then((d) => setChannels(d?.channels || []));
  };
  useEffect(load, []);

  const handleSubmit = async () => {
    const modelsArr = typeof form.models === "string" ? JSON.parse(form.models) : form.models;
    const payload: Record<string, unknown> = {
      ...form,
      models: modelsArr,
      currency: form.currency || "CNY",
      provider: form.provider || null,
    };
    // AK/SK 留空不传（避免覆盖已有值）
    if (!form.accessKeyId) delete payload.accessKeyId;
    if (!form.accessKeySecret) delete payload.accessKeySecret;
    if (editingId) {
      await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...payload }),
      });
    } else {
      await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    load();
  };

  const handleToggle = async (ch: Channel) => {
    await fetch("/api/admin/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ch.id, status: ch.status === "active" ? "disabled" : "active" }),
    });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此渠道吗？")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  };

  const startEdit = (ch: Channel) => {
    const modelsStr = Array.isArray(ch.models) ? JSON.stringify(ch.models) : ch.models;
    setForm({
      ...ch,
      models: modelsStr,
      apiKey: "",
      accessKeyId: ch.accessKeyId || "",
      accessKeySecret: "", // 脱敏的不再回填，留空=不修改
      currency: ch.currency || "CNY",
      provider: ch.provider || "",
    });
    setEditingId(ch.id);
    setShowForm(true);
  };

  /** 同步所有渠道余额 */
  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const resp = await fetch("/api/admin/channels/balance-sync", { method: "POST" });
      const result = await resp.json();
      if (result.synced > 0 || result.failed > 0) {
        alert(`同步完成：成功 ${result.synced} 个，失败 ${result.failed} 个` + (result.alerts?.length ? `\n⚠️ ${result.alerts.length} 个渠道余额低于阈值` : ""));
      }
      load();
    } catch {
      alert("同步失败，请检查网络");
    } finally {
      setSyncing(false);
    }
  };

  /** 同步单个渠道余额 */
  const handleSyncOne = async (ch: Channel) => {
    setSyncingChannel(ch.id);
    try {
      const resp = await fetch("/api/admin/channels/balance-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: ch.id }),
      });
      const result = await resp.json();
      if (result.failed > 0) {
        alert(`${ch.name} 余额同步失败`);
      }
      load();
    } catch {
      alert("同步失败");
    } finally {
      setSyncingChannel(null);
    }
  };

  /** 手动更新余额 */
  const handleManualBalance = async (ch: Channel, balance: string) => {
    const val = parseFloat(balance);
    if (isNaN(val)) return;
    await fetch("/api/admin/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: ch.id,
        balance: val,
        balanceCurrency: ch.currency || "CNY",
      }),
    });
    load();
  };

  /** 更新预警阈值 */
  const handleUpdateThreshold = async (ch: Channel, threshold: string) => {
    const val = parseFloat(threshold);
    if (isNaN(val)) return;
    await fetch("/api/admin/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ch.id, balanceAlertThreshold: val }),
    });
    load();
  };

  /** 判断是否自动同步供应商 */
  const isAuto = (ch: Channel) => {
    if (ch.balanceSyncMode === "auto") return true;
    if (ch.balanceSyncMode === "manual") return false;
    return AUTO_PROVIDERS.includes(ch.provider || "");
  };

  /** 获取余额显示文本 */
  const getBalanceDisplay = (ch: Channel) => {
    if (ch.balance == null) return null;
    const cur = ch.balanceCurrency || ch.currency || "CNY";
    const sym = cur === "USD" ? "$" : "¥";
    return `${sym}${Number(ch.balance).toFixed(2)}`;
  };

  /** 获取余额状态 */
  const getBalanceStatus = (ch: Channel): "normal" | "warning" | "danger" | "none" => {
    if (ch.balance == null) return "none";
    const threshold = ch.balanceAlertThreshold ?? DEFAULT_THRESHOLDS[ch.balanceCurrency || ch.currency || "CNY"] ?? 100;
    if (ch.balance < threshold * 0.2) return "danger";
    if (ch.balance < threshold) return "warning";
    return "normal";
  };

  /** 格式化同步时间 */
  const formatSyncTime = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">上游 API 渠道</h3>
        <div className="flex gap-2">
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="px-4 py-2 text-sm rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncing ? "🔄 同步中..." : "🔄 同步所有余额"}
          </button>
          <button
            onClick={() => { setForm(EMPTY); setEditingId(null); setShowForm(!showForm); }}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {showForm ? "取消" : "+ 添加渠道"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-indigo-200 p-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-gray-600 block mb-1">渠道名称</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Base URL</label>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">API Key {editingId && "(留空不修改)"}</label>
              <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} type="password"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">模型列表 (JSON 数组)</label>
              <input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">优先级 (数字越小越优先)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">结算币种</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="CNY">CNY (人民币)</option>
                <option value="USD">USD (美元)</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">供应商</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          {/* 阿里云 AK/SK 输入 — 仅 alibaba 供应商显示 */}
          {form.provider === "alibaba" && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-orange-50 rounded-lg border border-orange-100">
              <div>
                <label className="text-sm text-gray-600 block mb-1">AccessKey ID</label>
                <input
                  value={form.accessKeyId || ""}
                  onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
                  placeholder="LTAI5t..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">AccessKey Secret {editingId && "(留空不修改)"}</label>
                <input
                  value={form.accessKeySecret || ""}
                  onChange={(e) => setForm({ ...form, accessKeySecret: e.target.value })}
                  type="password"
                  placeholder="用于查询阿里云 BSS 余额"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div className="col-span-2 text-xs text-orange-500">
                💡 配置后系统将通过阿里云 BSS API 自动查询账户余额（需 RAM 账号有 <code className="bg-orange-100 px-1 rounded">AliyunBSSReadOnlyAccess</code> 权限）
              </div>
            </div>
          )}
          <div className="text-xs text-gray-400">
            💡 设置供应商后，价格同步会自动将官方价格写入该渠道（而非全局价格）
          </div>
          <button onClick={handleSubmit}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            {editingId ? "更新" : "添加"}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {channels.length === 0 ? (
          <div className="py-12 text-center text-gray-400">暂无渠道，请添加</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
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
                      {/* ===== 余额列 ===== */}
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
