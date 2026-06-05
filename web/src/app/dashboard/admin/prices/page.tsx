"use client";

import { useEffect, useState } from "react";

interface ModelPrice {
  id: string;
  model: string;
  channelId: string | null;
  channelName: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  displayName: string | null;
  deprecated: boolean;
  syncedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface Channel {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  model: "",
  channelId: "" as string,
  inputPerMillion: 0,
  outputPerMillion: 0,
  cachePerMillion: 0,
  displayName: "",
};

export default function PricesPage() {
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    setLoading(true);
    try {
      const [priceRes, channelRes] = await Promise.all([
        fetch("/api/admin/prices"),
        fetch("/api/admin/channels"),
      ]);
      const priceData = priceRes.ok ? await priceRes.json() : { prices: [] };
      const channelData = channelRes.ok ? await channelRes.json() : { channels: [] };
      setPrices(priceData.prices || []);
      setChannels((channelData.channels || []).map((c: any) => ({ id: c.id, name: c.name })));
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleEdit = (p: ModelPrice) => {
    setForm({
      model: p.model,
      channelId: p.channelId || "",
      inputPerMillion: p.inputPerMillion,
      outputPerMillion: p.outputPerMillion,
      cachePerMillion: p.cachePerMillion,
      displayName: p.displayName || "",
    });
    setEditingId(p.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    await fetch("/api/admin/prices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingId,
        inputPerMillion: Number(form.inputPerMillion),
        outputPerMillion: Number(form.outputPerMillion),
        cachePerMillion: Number(form.cachePerMillion),
        displayName: form.displayName || null,
      }),
    });
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此价格吗？删除全局价格后，该模型不会被同步回来。")) return;
    await fetch("/api/admin/prices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const handleToggleDeprecated = async (p: ModelPrice) => {
    await fetch("/api/admin/prices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, deprecated: !p.deprecated }),
    });
    load();
  };

  // 筛选
  const filtered = filterChannel === "all"
    ? prices
    : filterChannel === "global"
      ? prices.filter((p) => !p.channelId)
      : prices.filter((p) => p.channelId === filterChannel);

  if (loading) {
    return <div className="animate-pulse p-6 text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">模型价格管理</h3>
        <div className="flex gap-2 items-center">
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="all">全部渠道</option>
            <option value="global">全局价格</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 编辑表单 */}
      {showForm && (
        <div className="bg-white rounded-xl border border-indigo-200 p-6 space-y-4">
          <h4 className="text-sm font-medium text-gray-700">
            {editingId ? "编辑价格" : "添加价格"}
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">模型名称</label>
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                disabled={!!editingId}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">显示名称</label>
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="可选"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">输入价格 (¥/百万Token)</label>
              <input
                type="number"
                step="0.01"
                value={form.inputPerMillion}
                onChange={(e) => setForm({ ...form, inputPerMillion: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">输出价格 (¥/百万Token)</label>
              <input
                type="number"
                step="0.01"
                value={form.outputPerMillion}
                onChange={(e) => setForm({ ...form, outputPerMillion: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">缓存价格 (¥/百万Token)</label>
              <input
                type="number"
                step="0.01"
                value={form.cachePerMillion}
                onChange={(e) => setForm({ ...form, cachePerMillion: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              保存
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 价格列表 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400">暂无价格数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left py-2 font-medium">模型</th>
                <th className="text-left py-2 font-medium">渠道</th>
                <th className="text-right py-2 font-medium">输入 ¥/M</th>
                <th className="text-right py-2 font-medium">输出 ¥/M</th>
                <th className="text-right py-2 font-medium">缓存 ¥/M</th>
                <th className="text-center py-2 font-medium">状态</th>
                <th className="text-right py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className={`border-b border-gray-50 hover:bg-gray-50 ${p.deprecated ? "opacity-50" : ""}`}>
                  <td className="py-2">
                    <div>
                      <span className="font-medium text-gray-800">
                        {p.displayName || p.model}
                      </span>
                      {p.displayName && (
                        <span className="ml-2 text-xs text-gray-400 font-mono">{p.model}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    {p.channelId ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600">
                        {p.channelName}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                        全局（默认）
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right text-gray-700">¥{p.inputPerMillion}</td>
                  <td className="py-2 text-right text-gray-700">¥{p.outputPerMillion}</td>
                  <td className="py-2 text-right text-gray-700">¥{p.cachePerMillion}</td>
                  <td className="py-2 text-center">
                    {p.deprecated ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-600">
                        已废弃
                      </span>
                    ) : p.syncedAt ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-600">
                        已同步
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600">
                        手动
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      onClick={() => handleEdit(p)}
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleToggleDeprecated(p)}
                      className="text-xs text-amber-500 hover:text-amber-700"
                    >
                      {p.deprecated ? "恢复" : "废弃"}
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <p>💡 全局价格：适用于所有渠道的默认价格，可通过同步从官网更新</p>
        <p>💡 渠道价格：为特定渠道设置的专属价格，优先级高于全局价格</p>
        <p>💡 删除全局价格后，该模型会加入同步黑名单，不会被同步重新添加</p>
      </div>
    </div>
  );
}
