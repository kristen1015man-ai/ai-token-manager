"use client";

import GlassSelect from "@/components/GlassSelect";
import { type Channel, type FormState } from "./price-types";

interface PriceFormProps {
  form: FormState;
  setForm: (f: FormState) => void;
  channels: Channel[];
  editingId: string | null;
  onSave: () => void;
  onCancel: () => void;
}

function getFormCurrency(form: FormState, channels: Channel[]): string {
  if (!form.channelId) return "CNY";
  return channels.find((c) => c.id === form.channelId)?.currency || "CNY";
}

export default function PriceForm({ form, setForm, channels, editingId, onSave, onCancel }: PriceFormProps) {
  const currencyLabel = getFormCurrency(form, channels) === "USD" ? "$/百万 Token" : "¥/百万 Token";

  return (
    <div className="glass-card-static p-6 space-y-4">
      <h4 className="text-sm font-medium text-gray-700">{editingId ? "编辑价格" : "添加价格"}</h4>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <label className="text-xs text-gray-500 block mb-1">模型名称</label>
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            disabled={!!editingId}
            placeholder="例如 deepseek-chat"
            className="glass-input w-full disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">所属渠道{!editingId && "*"}</label>
          {editingId ? (
            <div className="px-3 py-2 text-sm text-gray-500 rounded-lg bg-indigo-50/30 border border-indigo-100">
              {form.channelId
                ? channels.find((c) => c.id === form.channelId)?.name || form.channelId
                : "全局默认"}
            </div>
          ) : (
            <GlassSelect
              value={form.channelId}
              onChange={(v) => setForm({ ...form, channelId: v })}
              options={[
                { value: "", label: "-- 选择渠道 --" },
                ...channels.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className="w-full"
            />
          )}
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">显示名称</label>
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="可选"
            className="glass-input w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">输入价格 ({currencyLabel})</label>
          <input
            type="number"
            step="0.0001"
            value={form.inputPerMillion}
            onChange={(e) => setForm({ ...form, inputPerMillion: Number(e.target.value) })}
            className="glass-input w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">输出价格 ({currencyLabel})</label>
          <input
            type="number"
            step="0.0001"
            value={form.outputPerMillion}
            onChange={(e) => setForm({ ...form, outputPerMillion: Number(e.target.value) })}
            className="glass-input w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">缓存价格 ({currencyLabel})</label>
          <input
            type="number"
            step="0.0001"
            value={form.cachePerMillion}
            onChange={(e) => setForm({ ...form, cachePerMillion: Number(e.target.value) })}
            className="glass-input w-full"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="glass-btn">保存</button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-xl font-medium transition-all duration-200 bg-gray-50 text-gray-500 border border-gray-100"
        >
          取消
        </button>
      </div>
    </div>
  );
}
