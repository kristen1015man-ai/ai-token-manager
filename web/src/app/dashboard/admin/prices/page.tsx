"use client";

import { useEffect, useState } from "react";

interface ModelPrice {
  id: string;
  model: string;
  channelId: string | null;
  channelName: string;
  channelCurrency: string | null;   // "CNY" | "USD" | null
  channelProvider: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  displayName: string | null;
  currency: string;                  // 价格的原始币种
  deprecated: boolean;
  syncedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface Channel {
  id: string;
  name: string;
  currency: string;
  provider: string | null;
}

interface ExchangeRate {
  rate: number;
  source: string;
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
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [priceRes, channelRes] = await Promise.all([
        fetch("/api/admin/prices"),
        fetch("/api/admin/channels"),
      ]);
      const priceData = priceRes.ok ? await priceRes.json() : { prices: [], exchangeRate: null };
      const channelData = channelRes.ok ? await channelRes.json() : { channels: [] };
      setPrices(priceData.prices || []);
      setExchangeRate(priceData.exchangeRate || null);
      setChannels((channelData.channels || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        currency: c.currency || "CNY",
        provider: c.provider || null,
      })));
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/prices/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const rateInfo = data.exchangeRate ? `，汇率 1 USD = ${data.exchangeRate.rate.toFixed(4)} CNY` : "";
        alert(`同步完成：更新 ${data.updated} 条，新增 ${data.added} 条${rateInfo}`);
      } else {
        alert(data.error || "同步失败");
      }
    } catch {
      alert("同步请求失败");
    }
    setSyncing(false);
    load();
  };

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

  const handleAdd = () => {
    setForm({ ...EMPTY_FORM, channelId: channels.length > 0 ? channels[0].id : "" });
    setEditingId(null);
    setShowForm(true);
  };

  /** 获取当前表单所选渠道的币种 */
  const getFormCurrency = (): string => {
    if (!form.channelId) return "CNY";
    const ch = channels.find((c) => c.id === form.channelId);
    return ch?.currency || "CNY";
  };

  const currencySymbol = getFormCurrency() === "USD" ? "$" : "¥";
  const currencyLabel = getFormCurrency() === "USD" ? "$/百万Token" : "¥/百万Token";

  const handleSave = async () => {
    if (editingId) {
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
    } else {
      if (!form.model.trim()) {
        alert("请输入模型名称");
        return;
      }
      if (!form.channelId) {
        alert("请选择渠道");
        return;
      }
      const res = await fetch("/api/admin/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: form.model.trim(),
          channelId: form.channelId || null,
          inputPerMillion: Number(form.inputPerMillion),
          outputPerMillion: Number(form.outputPerMillion),
          cachePerMillion: Number(form.cachePerMillion || 0),
          displayName: form.displayName || null,
          currency: getFormCurrency(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "创建失败");
        return;
      }
    }
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此价格吗？删除后该价格会加入同步黑名单，不会被同步重新添加。")) return;
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

  // 筛选：只显示渠道级价格，过滤掉全局价格
  const channelPrices = prices.filter((p) => !!p.channelId);
  const filtered = filterChannel === "all"
    ? channelPrices
    : channelPrices.filter((p) => p.channelId === filterChannel);

  /** 渲染价格单元格（支持双币种显示） */
  const PriceCell = ({ value, row }: { value: number; row: ModelPrice }) => {
    const isUSD = row.channelCurrency === "USD" || row.currency === "USD";
    if (isUSD && exchangeRate) {
      return (
        <div className="text-right">
          <div className="text-gray-700">${value}</div>
          <div className="text-[10px] text-gray-400">≈ ¥{(value * exchangeRate.rate).toFixed(2)}</div>
        </div>
      );
    }
    return <div className="text-right text-gray-700">¥{value}</div>;
  };

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
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-2 text-sm rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
          >
            {syncing ? "同步中..." : "↻ 同步官方价格"}
          </button>
          <button
            onClick={handleAdd}
            className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            + 添加价格
          </button>
        </div>
      </div>

      {/* 汇率信息条 */}
      {exchangeRate && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-4 py-2.5 rounded-lg">
          <span>💱 当前汇率：1 USD = {exchangeRate.rate.toFixed(4)} CNY</span>
          <span className="text-amber-500">（来源：{exchangeRate.source}）</span>
        </div>
      )}

      {/* 编辑表单 */}
      {showForm && (
        <div className="bg-white rounded-xl border border-indigo-200 p-6 space-y-4">
          <h4 className="text-sm font-medium text-gray-700">
            {editingId ? "编辑价格" : "添加价格"}
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">模型名称</label>
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                disabled={!!editingId}
                placeholder="如 deepseek-chat"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">所属渠道 {!editingId && "*"}</label>
              {editingId ? (
                <div className="px-3 py-2 text-sm text-gray-500 bg-gray-50 rounded-lg border border-gray-100">
                  {form.channelId
                    ? channels.find((c) => c.id === form.channelId)?.name || form.channelId
                    : "全局（默认）"}
                </div>
              ) : (
                <select
                  value={form.channelId}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">-- 选择渠道 --</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
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
              <label className="text-xs text-gray-500 block mb-1">输入价格 ({currencyLabel})</label>
              <input
                type="number"
                step="0.01"
                value={form.inputPerMillion}
                onChange={(e) => setForm({ ...form, inputPerMillion: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">输出价格 ({currencyLabel})</label>
              <input
                type="number"
                step="0.01"
                value={form.outputPerMillion}
                onChange={(e) => setForm({ ...form, outputPerMillion: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">缓存价格 ({currencyLabel})</label>
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
                <th className="text-right py-2 font-medium">输入价格</th>
                <th className="text-right py-2 font-medium">输出价格</th>
                <th className="text-right py-2 font-medium">缓存价格</th>
                <th className="text-center py-2 font-medium">状态</th>
                <th className="text-right py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isUSD = p.channelCurrency === "USD" || p.currency === "USD";
                return (
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
                      <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600">
                        {p.channelName}
                      </span>
                    </td>
                    <td className="py-2"><PriceCell value={p.inputPerMillion} row={p} /></td>
                    <td className="py-2"><PriceCell value={p.outputPerMillion} row={p} /></td>
                    <td className="py-2"><PriceCell value={p.cachePerMillion} row={p} /></td>
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <p>💡 每个渠道独立管理价格，通过同步从官网自动更新</p>
        <p>💡 USD 渠道显示美元原价 + 人民币换算价格，计费统一按人民币结算</p>
        <p>💡 删除价格后会加入同步黑名单，不会被同步重新添加</p>
      </div>
    </div>
  );
}
