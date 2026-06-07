"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchApi, ApiError } from "../../../../lib/fetcher";
import EmptyState from "@/components/EmptyState";
import { type Alert, type AlertSettings, DEFAULT_SETTINGS, TYPE_LABELS } from "./alert-types";
import FeishuTab from "./FeishuTab";

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
    try {
      const d = await fetchApi<{ settings: AlertSettings }>("/api/admin/alerts/settings");
      setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
    } catch {}
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const d = await fetchApi<{ alerts: Alert[] }>("/api/admin/alerts");
      setAlerts(d.alerts || []);
    } catch {}
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
      await fetchApi("/api/admin/alerts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      flash("ok", "设置已保存");
    } catch (e) {
      flash("err", e instanceof ApiError ? e.message : "保存失败");
    }
    setSaving(false);
  };

  /* ===== 测试飞书通知 ===== */
  const handleTestFeishu = async () => {
    setTesting(true);
    try {
      const d = await fetchApi<{ message: string }>("/api/admin/alerts/test-feishu", { method: "POST" });
      flash("ok", d.message || "测试通知已发送");
    } catch (e) {
      flash("err", e instanceof ApiError ? e.message : "发送失败");
    }
    setTesting(false);
  };

  /* ===== 样式 ===== */
  const tabClass = (key: TabKey) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
      tab === key
        ? "bg-indigo-600 text-white shadow-sm"
        : "text-gray-600"
    }`;

  return (
    <div className="space-y-5">
      {/* 提示消息 */}
      {msg && (
        <div
          className={`px-4 py-2 rounded-xl text-sm ${
            msg.type === "ok" ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 p-1 rounded-xl w-fit bg-white border border-gray-100">
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
        <div className="glass-card-static p-5 space-y-5">
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
                  className="glass-input w-24"
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
                  className="glass-input w-24"
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
                  className="glass-input w-24"
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
                  className="glass-input w-24"
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
              className="glass-btn text-sm disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
          </div>
        </div>
      )}

      {/* ===== Tab 2: 飞书通知 ===== */}
      {tab === "feishu" && (
        <FeishuTab
          settings={settings}
          setSettings={setSettings}
          saving={saving}
          onSave={handleSave}
          onTestFeishu={handleTestFeishu}
          testing={testing}
        />
      )}

      {/* ===== Tab 3: 预警记录 ===== */}
      {tab === "history" && (
        <div className="glass-card-static p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">预警记录</h3>
            <span className="text-xs text-gray-400">最近 100 条</span>
          </div>
          {alerts.length === 0 ? (
            <EmptyState icon="" message="暂无预警记录" />
          ) : (
            <div className="overflow-x-auto">
              <table className="glass-table">
                <thead>
                  <tr>
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
