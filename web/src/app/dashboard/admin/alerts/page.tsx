"use client";

import { useEffect, useState, useCallback } from "react";

/* ===== 类型 ===== */
interface Alert {
  id: string;
  type: string;
  targetId: string;
  message: string;
  sentAt: string;
}

interface AlertSettings {
  personal_threshold: string;
  dept_threshold: string;
  company_threshold: string;
  anomaly_threshold: string;
  feishu_webhook_url: string;
  feishu_notify_enabled: string;
  feishu_notify_types: string;
}

const DEFAULT_SETTINGS: AlertSettings = {
  personal_threshold: "80",
  dept_threshold: "80",
  company_threshold: "90",
  anomaly_threshold: "10",
  feishu_webhook_url: "",
  feishu_notify_enabled: "false",
  feishu_notify_types: "personal_80,personal_100,dept_80,company_90,anomaly",
};

const TYPE_LABELS: Record<string, string> = {
  personal_80: "🟡 个人 80%",
  personal_100: "🔴 个人超额",
  dept_80: "🟠 部门 80%",
  company_90: "🔴 公司 90%",
  anomaly: "⚠️ 异常使用",
};

const NOTIFY_TYPE_OPTIONS = [
  { key: "personal_80", label: "个人 80% 预警" },
  { key: "personal_100", label: "个人超额预警" },
  { key: "dept_80", label: "部门 80% 预警" },
  { key: "company_90", label: "公司 90% 预警" },
  { key: "anomaly", label: "异常使用预警" },
];

/* ===== Tab 定义 ===== */
type TabKey = "threshold" | "feishu" | "history";

export default function AlertsPage() {
  const [tab, setTab] = useState<TabKey>("threshold");
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_SETTINGS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 加载设置和预警记录
  const loadSettings = useCallback(async () => {
    const r = await fetch("/api/admin/alerts/settings");
    if (r.ok) {
      const d = await r.json();
      setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    const r = await fetch("/api/admin/alerts");
    if (r.ok) {
      const d = await r.json();
      setAlerts(d.alerts || []);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadAlerts();
  }, [loadSettings, loadAlerts]);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  /* ===== 保存设置 ===== */
  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/alerts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (r.ok) {
        flash("ok", "设置已保存");
      } else {
        const d = await r.json();
        flash("err", d.error || "保存失败");
      }
    } catch {
      flash("err", "网络错误");
    }
    setSaving(false);
  };

  /* ===== 测试飞书通知 ===== */
  const handleTestFeishu = async () => {
    setTesting(true);
    try {
      const r = await fetch("/api/admin/alerts/test-feishu", { method: "POST" });
      const d = await r.json();
      if (r.ok) {
        flash("ok", d.message || "测试通知已发送");
      } else {
        flash("err", d.error || "发送失败");
      }
    } catch {
      flash("err", "网络错误");
    }
    setTesting(false);
  };

  /* ===== 切换通知类型 ===== */
  const toggleNotifyType = (key: string) => {
    const current = settings.feishu_notify_types.split(",").filter(Boolean);
    const next = current.includes(key)
      ? current.filter((t) => t !== key)
      : [...current, key];
    setSettings({ ...settings, feishu_notify_types: next.join(",") });
  };

  /* ===== 样式 ===== */
  const tabClass = (key: TabKey) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      tab === key
        ? "bg-indigo-600 text-white shadow-sm"
        : "text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <div className="space-y-5">
      {/* 提示消息 */}
      {msg && (
        <div
          className={`px-4 py-2 rounded-lg text-sm ${
            msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 bg-gray-50 p-1 rounded-xl w-fit">
        <button className={tabClass("threshold")} onClick={() => setTab("threshold")}>
          🎯 阈值设置
        </button>
        <button className={tabClass("feishu")} onClick={() => setTab("feishu")}>
          📨 飞书通知
        </button>
        <button className={tabClass("history")} onClick={() => setTab("history")}>
          📋 预警记录
        </button>
      </div>

      {/* ===== Tab 1: 阈值设置 ===== */}
      {tab === "threshold" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <p className="text-sm text-gray-500">
            设置用量达到限额的百分之几时触发预警通知。阈值范围 1-100。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* 个人阈值 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                个人用量预警阈值
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.personal_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, personal_threshold: e.target.value })
                  }
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">当个人本月用量达到限额的此百分比时触发</p>
            </div>

            {/* 部门阈值 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                部门用量预警阈值
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.dept_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, dept_threshold: e.target.value })
                  }
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">当部门本月用量达到限额的此百分比时触发</p>
            </div>

            {/* 公司阈值 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                公司用量预警阈值
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.company_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, company_threshold: e.target.value })
                  }
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">当公司本月总用量达到限额的此百分比时触发</p>
            </div>

            {/* 异常阈值 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                异常用量检测阈值
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={settings.anomaly_threshold}
                  onChange={(e) =>
                    setSettings({ ...settings, anomaly_threshold: e.target.value })
                  }
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <span className="text-sm text-gray-500">元/小时</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">单人 1 小时内消耗超过此金额时触发异常预警</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
          </div>
        </div>
      )}

      {/* ===== Tab 2: 飞书通知 ===== */}
      {tab === "feishu" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <p className="text-sm text-gray-500">
            配置飞书机器人 Webhook，预警触发时自动推送消息到飞书群。
          </p>

          {/* 开关 */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-700">启用飞书通知</p>
              <p className="text-xs text-gray-400 mt-0.5">开启后，预警触发时会自动推送到飞书群</p>
            </div>
            <button
              onClick={() =>
                setSettings({
                  ...settings,
                  feishu_notify_enabled: settings.feishu_notify_enabled === "true" ? "false" : "true",
                })
              }
              className={`relative w-12 h-6 rounded-full transition-colors ${
                settings.feishu_notify_enabled === "true" ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  settings.feishu_notify_enabled === "true" ? "left-6.5 translate-x-0" : "left-0.5"
                }`}
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
              onChange={(e) =>
                setSettings({ ...settings, feishu_webhook_url: e.target.value })
              }
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
                    className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                      active
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
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
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
            <button
              onClick={handleTestFeishu}
              disabled={testing}
              className="px-5 py-2 bg-white text-indigo-600 text-sm rounded-lg border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
            >
              {testing ? "发送中..." : "🧪 发送测试通知"}
            </button>
          </div>
        </div>
      )}

      {/* ===== Tab 3: 预警记录 ===== */}
      {tab === "history" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">预警记录</h3>
            <span className="text-xs text-gray-400">最近 100 条</span>
          </div>
          {alerts.length === 0 ? (
            <div className="py-12 text-center text-gray-400">暂无预警记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500">
                    <th className="text-left py-2 font-medium">类型</th>
                    <th className="text-left py-2 font-medium">时间</th>
                    <th className="text-left py-2 font-medium">消息</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2">{TYPE_LABELS[a.type] || a.type}</td>
                      <td className="py-2 text-gray-500">
                        {new Date(a.sentAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="py-2 text-gray-700 max-w-md truncate">{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
