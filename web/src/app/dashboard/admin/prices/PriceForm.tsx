"use client";

/** 价格管理页 — 添加/编辑表单子组件（毛玻璃风格） */
import { type Channel, type FormState } from "./price-types";

interface PriceFormProps {
  form: FormState;
  setForm: (f: FormState) => void;
  channels: Channel[];
  editingId: string | null;
  onSave: () => void;
  onCancel: () => void;
}

/** 获取当前表单所选渠道的币种 */
function getFormCurrency(form: FormState, channels: Channel[]): string {
  if (!form.channelId) return "CNY";
  const ch = channels.find((c) => c.id === form.channelId);
  return ch?.currency || "CNY";
}

export default function PriceForm({ form, setForm, channels, editingId, onSave, onCancel }: PriceFormProps) {
  const currencyLabel = getFormCurrency(form, channels) === "USD" ? "$/百万Token" : "¥/百万Token";

  return (
    <div className="glass-card-static p-6 space-y-4">
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
            className="glass-input w-full disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">所属渠道 {!editingId && "*"}</label>
          {editingId ? (
            <div
              className="px-3 py-2 text-sm text-gray-500 rounded-lg bg-indigo-50/30 border border-indigo-100"
            >
              {form.channelId
                ? channels.find((c) => c.id === form.channelId)?.name || form.channelId
                : "全局（默认）"}
            </div>
          ) : (
            <select
              value={form.channelId}
              onChange={(e) => setForm({ ...form, channelId: e.target.value })}
              className="glass-input w-full"
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
            className="glass-input w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">输入价格 ({currencyLabel})</label>
          <input
            type="number"
            step="0.01"
            value={form.inputPerMillion}
            onChange={(e) => setForm({ ...form, inputPerMillion: Number(e.target.value) })}
            className="glass-input w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">输出价格 ({currencyLabel})</label>
          <input
            type="number"
            step="0.01"
            value={form.outputPerMillion}
            onChange={(e) => setForm({ ...form, outputPerMillion: Number(e.target.value) })}
            className="glass-input w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">缓存价格 ({currencyLabel})</label>
          <input
            type="number"
            step="0.01"
            value={form.cachePerMillion}
            onChange={(e) => setForm({ ...form, cachePerMillion: Number(e.target.value) })}
            className="glass-input w-full"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="glass-btn">
          保存
        </button>
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
