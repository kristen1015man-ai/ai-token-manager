"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../../../lib/fetcher";
import EmptyState from "@/components/EmptyState";
import PageLoader from "@/components/PageLoader";
import { type ModelPrice, type Channel, type ExchangeRate, EMPTY_FORM, type FormState } from "./price-types";
import PriceCell from "./PriceCell";
import PriceForm from "./PriceForm";
import GlassSelect from "@/components/GlassSelect";

export default function PricesPage() {
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [syncing, setSyncing] = useState(false);

  const loadExchangeRate = async () => {
    try {
      const rate = await fetchApi<ExchangeRate>("/api/admin/exchange-rate");
      setExchangeRate(rate);
    } catch {
      setExchangeRate(null);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [priceData, channelData] = await Promise.all([
        fetchApi<{ prices: ModelPrice[]; exchangeRate?: ExchangeRate | null }>("/api/admin/prices").catch(() => ({ prices: [], exchangeRate: null })),
        fetchApi<{ channels: Array<{ id: string; name: string; currency: string; provider: string | null }> }>("/api/admin/channels?summary=1").catch(() => ({ channels: [] })),
      ]);
      setPrices(priceData.prices || []);
      setChannels((channelData.channels || []).map((c) => ({
        id: c.id,
        name: c.name,
        currency: c.currency || "CNY",
        provider: c.provider || null,
      })));
      void loadExchangeRate();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await fetchApi<{
        success: boolean;
        updated: number;
        added: number;
        skipped?: number;
        skippedManual?: number;
        skippedBlacklist?: number;
        warnings?: string[];
        exchangeRate?: ExchangeRate;
        error?: string;
      }>("/api/admin/prices/sync", { method: "POST" });
      const rateInfo = data.exchangeRate ? `，汇率 1 USD = ${data.exchangeRate.rate.toFixed(4)} CNY` : "";
      const skippedInfo = data.skipped ? `，跳过 ${data.skipped} 条（手动 ${data.skippedManual ?? 0}，黑名单 ${data.skippedBlacklist ?? 0}）` : "";
      const warningInfo = data.warnings?.length ? `\n\n注意：\n${data.warnings.map((w) => `- ${w}`).join("\n")}` : "";
      alert(`同步完成：更新 ${data.updated} 条，新增 ${data.added} 条${skippedInfo}${rateInfo}${warningInfo}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "同步请求失败");
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

  const getFormCurrency = (): string => {
    if (!form.channelId) return "CNY";
    const ch = channels.find((c) => c.id === form.channelId);
    return ch?.currency || "CNY";
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await fetchApi("/api/admin/prices", {
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
        if (!form.model.trim()) { alert("请输入模型名称"); return; }
        if (!form.channelId) { alert("请选择渠道"); return; }
        await fetchApi("/api/admin/prices", {
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
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此价格吗？删除后该价格会加入同步黑名单，不会被同步重新添加。")) return;
    try {
      await fetchApi("/api/admin/prices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "删除失败");
    }
    load();
  };

  const handleToggleDeprecated = async (p: ModelPrice) => {
    try {
      await fetchApi("/api/admin/prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, deprecated: !p.deprecated }),
      });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "操作失败");
    }
    load();
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  // 筛选：默认显示全部价格；渠道价和全局默认价可分别查看
  const channelPrices = prices.filter((p) => !!p.channelId);
  const globalPrices = prices.filter((p) => !p.channelId);
  const channelModelSet = new Set(channelPrices.map((p) => p.model));
  const effectiveGlobalPrices = globalPrices.filter((p) => !channelModelSet.has(p.model));
  const effectivePrices = [...channelPrices, ...effectiveGlobalPrices];
  const filtered = filterChannel === "all"
    ? effectivePrices
    : filterChannel === "channel"
      ? channelPrices
      : filterChannel === "global"
        ? globalPrices
        : channelPrices.filter((p) => p.channelId === filterChannel);

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">模型价格管理</h3>
        <div className="flex gap-2 items-center">
          <GlassSelect
            value={filterChannel}
            onChange={setFilterChannel}
            options={[
              { value: "all", label: "全部价格" },
              { value: "channel", label: "全部渠道价格" },
              { value: "global", label: "全局默认价格" },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
            placeholder="全部价格"
            className="text-sm"
          />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-2 text-sm rounded-xl font-medium transition-all duration-200 disabled:opacity-50 bg-indigo-50/50 text-indigo-600 border border-indigo-200/50"
          >
            {syncing ? "同步中..." : "↻ 同步官方价格"}
          </button>
          <button
            onClick={handleAdd}
            className="glass-btn text-sm"
          >
            + 添加价格
          </button>
        </div>
      </div>

      {/* 汇率信息条 */}
      {exchangeRate && (
        <div className="flex items-center gap-2 text-xs text-amber-700 px-4 py-2.5 rounded-xl bg-amber-50/60 border border-amber-200 backdrop-blur-sm">
          <span>💱 当前汇率：1 USD = {exchangeRate.rate.toFixed(4)} CNY</span>
          <span className="text-amber-500">（来源：{exchangeRate.source}）</span>
        </div>
      )}

      {/* 编辑表单 */}
      {showForm && (
        <PriceForm
          form={form}
          setForm={setForm}
          channels={channels}
          editingId={editingId}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      )}

      {/* 价格列表 */}
      <div className="glass-card-static p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>当前显示 {filtered.length} 条</span>
          <span>渠道价格 {channelPrices.length} 条</span>
          <span>全局默认 {globalPrices.length} 条</span>
          <span>有效全局 {effectiveGlobalPrices.length} 条</span>
          <span>渠道 {channels.length} 个</span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="" message="暂无价格数据" />
        ) : (
          <table className="glass-table">
            <thead>
              <tr>
                <th className="text-left">模型</th>
                <th className="text-left">渠道</th>
                <th className="text-right">输入价格</th>
                <th className="text-right">输出价格</th>
                <th className="text-right">缓存价格</th>
                <th className="text-center">状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className={`${p.deprecated ? "opacity-50" : ""}`}>
                  <td>
                    <div>
                      <span>{p.displayName || p.model}</span>
                      {p.displayName && (
                        <span className="ml-2 text-xs text-gray-400 font-mono">{p.model}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600">
                      {p.channelName}
                    </span>
                  </td>
                  <td><PriceCell value={p.inputPerMillion} row={p} exchangeRate={exchangeRate} /></td>
                  <td><PriceCell value={p.outputPerMillion} row={p} exchangeRate={exchangeRate} /></td>
                  <td><PriceCell value={p.cachePerMillion} row={p} exchangeRate={exchangeRate} /></td>
                  <td className="text-center">
                    {p.deprecated ? (
                      <span className="glass-badge glass-badge-amber">已废弃</span>
                    ) : p.syncedAt ? (
                      <span className="glass-badge glass-badge-green">已同步</span>
                    ) : (
                      <span className="glass-badge glass-badge-indigo">手动</span>
                    )}
                  </td>
                  <td className="text-right space-x-2">
                    <button onClick={() => handleEdit(p)} className="text-xs text-indigo-500 hover:text-indigo-700">编辑</button>
                    <button onClick={() => handleToggleDeprecated(p)} className="text-xs text-amber-500 hover:text-amber-700">
                      {p.deprecated ? "恢复" : "废弃"}
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
                  </td>
                </tr>
              ))}
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
