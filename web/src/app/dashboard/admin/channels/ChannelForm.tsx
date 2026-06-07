"use client";

/** 渠道管理页 — 添加/编辑表单子组件（毛玻璃风格） */
import type { ChannelFormState } from "./channel-types";
import { PROVIDERS } from "./channel-types";

interface ChannelFormProps {
  form: ChannelFormState;
  setForm: (f: ChannelFormState) => void;
  editingId: string | null;
  onSubmit: () => void;
}

export default function ChannelForm({ form, setForm, editingId, onSubmit }: ChannelFormProps) {
  return (
    <div className="glass-card-static p-6 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-gray-600 block mb-1">渠道名称</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="glass-input w-full" />
        </div>
        <div>
          <label className="text-sm text-gray-600 block mb-1">Base URL</label>
          <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            className="glass-input w-full" />
        </div>
        <div>
          <label className="text-sm text-gray-600 block mb-1">API Key {editingId && "(留空不修改)"}</label>
          <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} type="password"
            className="glass-input w-full" />
        </div>
        <div>
          <label className="text-sm text-gray-600 block mb-1">模型列表 (JSON 数组)</label>
          <input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })}
            className="glass-input w-full font-mono" />
        </div>
        <div>
          <label className="text-sm text-gray-600 block mb-1">优先级 (数字越小越优先)</label>
          <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            className="glass-input w-full" />
        </div>
        <div>
          <label className="text-sm text-gray-600 block mb-1">结算币种</label>
          <select
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            className="glass-input w-full"
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
            className="glass-input w-full"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>
      {/* 阿里云 AK/SK 输入 — 仅 alibaba 供应商显示 */}
      {form.provider === "alibaba" && (
        <div
          className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-orange-50/30 border border-orange-200/50"
        >
          <div>
            <label className="text-sm text-gray-600 block mb-1">AccessKey ID</label>
            <input
              value={form.accessKeyId || ""}
              onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
              placeholder="LTAI5t..."
              className="glass-input w-full font-mono"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 block mb-1">AccessKey Secret {editingId && "(留空不修改)"}</label>
            <input
              value={form.accessKeySecret || ""}
              onChange={(e) => setForm({ ...form, accessKeySecret: e.target.value })}
              type="password"
              placeholder="用于查询阿里云 BSS 余额"
              className="glass-input w-full font-mono"
            />
          </div>
          <div className="col-span-2 text-xs text-orange-500">
            配置后系统将通过阿里云 BSS API 自动查询账户余额（需 RAM 账号有 <code
              className="px-1 rounded bg-orange-50"
            >AliyunBSSReadOnlyAccess</code> 权限）
          </div>
        </div>
      )}
      <div className="text-xs text-gray-400">
        设置供应商后，价格同步会自动将官方价格写入该渠道（而非全局价格）
      </div>
      <button onClick={onSubmit} className="glass-btn">
        {editingId ? "更新" : "添加"}
      </button>
    </div>
  );
}
