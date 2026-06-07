"use client";

/** 预警管理页 — 飞书通知配置 Tab */
import { type AlertSettings, NOTIFY_TYPE_OPTIONS } from "./alert-types";

interface FeishuTabProps {
  settings: AlertSettings;
  setSettings: (s: AlertSettings) => void;
  saving: boolean;
  onSave: () => void;
  onTestFeishu: () => void;
  testing: boolean;
}

export default function FeishuTab({ settings, setSettings, saving, onSave, onTestFeishu, testing }: FeishuTabProps) {
  const toggleNotifyType = (key: string) => {
    const current = settings.feishu_notify_types.split(",").filter(Boolean);
    const next = current.includes(key)
      ? current.filter((t) => t !== key)
      : [...current, key];
    setSettings({ ...settings, feishu_notify_types: next.join(",") });
  };

  const toggleEnabled = () => {
    setSettings({
      ...settings,
      feishu_notify_enabled: settings.feishu_notify_enabled === "true" ? "false" : "true",
    });
  };

  return (
    <div className="glass-card-static p-5 space-y-5">
      <p className="text-sm text-gray-500">
        配置飞书机器人 Webhook，预警触发时自动推送消息到飞书群。
      </p>

      {/* 开关 */}
      <div
        className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50 border border-gray-100"
      >
        <div>
          <p className="font-medium text-gray-700">启用飞书通知</p>
          <p className="text-xs text-gray-400 mt-0.5">开启后，预警触发时会自动推送到飞书群</p>
        </div>
        <button
          onClick={toggleEnabled}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            settings.feishu_notify_enabled === "true" ? "bg-indigo-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform`}
            style={{
              left: settings.feishu_notify_enabled === "true" ? "26px" : "2px",
            }}
          />
        </button>
      </div>

      {/* Webhook 地址 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          飞书 Webhook 地址
        </label>
        <input
          type="url"
          value={settings.feishu_webhook_url}
          onChange={(e) => setSettings({ ...settings, feishu_webhook_url: e.target.value })}
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx"
          className="glass-input w-full"
        />
        <p className="text-xs text-gray-400 mt-1">
          在飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人 获取 Webhook 地址
        </p>
      </div>

      {/* 通知类型选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          通知类型
        </label>
        <div className="flex flex-wrap gap-2">
          {NOTIFY_TYPE_OPTIONS.map((opt) => {
            const active = settings.feishu_notify_types.split(",").includes(opt.key);
            return (
              <button
                key={opt.key}
                onClick={() => toggleNotifyType(opt.key)}
                className={`px-3 py-1.5 text-xs rounded-full transition-all duration-200 ${
                  active
                    ? "bg-indigo-50 border border-indigo-200 text-indigo-600"
                    : "bg-white border border-gray-100 text-gray-500"
                }`}
              >
                {active ? "✓ " : ""}{opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="glass-btn disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存设置"}
        </button>
        <button
          onClick={onTestFeishu}
          disabled={testing}
          className="px-5 py-2 text-sm rounded-xl font-medium transition-all duration-200 disabled:opacity-50 bg-indigo-50 text-indigo-600 border border-indigo-100"
        >
          {testing ? "发送中..." : "发送测试通知"}
        </button>
      </div>
    </div>
  );
}
