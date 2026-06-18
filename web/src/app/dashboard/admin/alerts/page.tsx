"use client";

import { useCallback, useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import { ApiError, fetchApi } from "../../../../lib/fetcher";
import FeishuTab from "./FeishuTab";
import {
  DEFAULT_SETTINGS,
  TYPE_LABELS,
  type AdminOption,
  type Alert,
  type AlertSettings,
  type FeishuChatOption,
} from "./alert-types";

type TabKey = "threshold" | "feishu" | "history";

function NumberField({
  label,
  value,
  suffix,
  hint,
  min = 1,
  max,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  hint: string;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="glass-input w-24"
        />
        <span className="text-sm text-gray-500">{suffix}</span>
      </div>
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  );
}

export default function AlertsPage() {
  const [tab, setTab] = useState<TabKey>("threshold");
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_SETTINGS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingLeaderboard, setSendingLeaderboard] = useState(false);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [feishuChats, setFeishuChats] = useState<FeishuChatOption[]>([]);
  const [loadingFeishuChats, setLoadingFeishuChats] = useState(false);
  const [feishuChatsError, setFeishuChatsError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const data = await fetchApi<{ settings: AlertSettings }>("/api/admin/alerts/settings");
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    } catch {
      // Keep defaults when the settings endpoint is temporarily unavailable.
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchApi<{ alerts: Alert[] }>("/api/admin/alerts");
      setAlerts(data.alerts || []);
    } catch {
      setAlerts([]);
    }
  }, []);

  const loadAdmins = useCallback(async () => {
    try {
      const data = await fetchApi<{ admins: AdminOption[] }>("/api/admin/admins-list");
      setAdmins(data.admins || []);
    } catch {
      setAdmins([]);
    }
  }, []);

  const loadFeishuChats = useCallback(async () => {
    setLoadingFeishuChats(true);
    setFeishuChatsError(null);
    try {
      const data = await fetchApi<{ chats: FeishuChatOption[] }>("/api/admin/feishu/chats");
      setFeishuChats(data.chats || []);
      if ((data.chats || []).length === 0) {
        setFeishuChatsError("机器人当前没有可读取的群组，请先把机器人加入目标群。");
      }
    } catch (e) {
      const text = e instanceof ApiError ? e.message : "读取飞书群组失败";
      setFeishuChats([]);
      setFeishuChatsError(text);
    } finally {
      setLoadingFeishuChats(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadAlerts();
    void loadAdmins();
  }, [loadSettings, loadAlerts, loadAdmins]);

  useEffect(() => {
    if (tab === "feishu" && feishuChats.length === 0 && !loadingFeishuChats && !feishuChatsError) {
      void loadFeishuChats();
    }
  }, [tab, feishuChats.length, feishuChatsError, loadFeishuChats, loadingFeishuChats]);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    window.setTimeout(() => setMsg(null), 3000);
  };

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
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    await fetchApi("/api/admin/alerts/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  };

  const handleTestFeishu = async () => {
    setTesting(true);
    try {
      const data = await fetchApi<{ message: string }>("/api/admin/alerts/test-feishu", { method: "POST" });
      flash("ok", data.message || "测试通知已发送");
    } catch (e) {
      flash("err", e instanceof ApiError ? e.message : "发送失败");
    } finally {
      setTesting(false);
    }
  };

  const handleSendLeaderboard = async () => {
    setSendingLeaderboard(true);
    try {
      await saveSettings();
      const data = await fetchApi<{ sent: number; failed: number; chatIds: string[]; skippedReason?: string | null }>(
        "/api/admin/leaderboard-send",
        { method: "POST" }
      );
      if (data.chatIds.length === 0) {
        flash("err", "未发送：请先选择排行榜飞书群组");
      } else if (data.skippedReason === "disabled") {
        flash("err", "未发送：请先启用排行榜定时发送");
      } else if (data.sent > 0 && data.failed === 0) {
        flash("ok", `排行榜已发送到 ${data.sent} 个群组`);
      } else if (data.sent > 0) {
        flash("err", `排行榜部分发送成功：成功 ${data.sent} 个，失败 ${data.failed} 个`);
      } else {
        flash("err", "排行榜未发送成功，请检查机器人是否已进群、飞书应用权限，或本月是否已有用量数据");
      }
    } catch (e) {
      flash("err", e instanceof ApiError ? e.message : "排行榜发送失败");
    } finally {
      setSendingLeaderboard(false);
    }
  };

  return (
    <div className="space-y-5">
      {msg && (
        <div
          className={`px-4 py-2 rounded-xl text-sm ${
            msg.type === "ok"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="rank-tabs">
        <button className={`rank-tab ${tab === "threshold" ? "rank-tab-active" : ""}`} onClick={() => setTab("threshold")}>
          阈值设置
        </button>
        <button className={`rank-tab ${tab === "feishu" ? "rank-tab-active" : ""}`} onClick={() => setTab("feishu")}>
          飞书通知
        </button>
        <button className={`rank-tab ${tab === "history" ? "rank-tab-active" : ""}`} onClick={() => setTab("history")}>
          预警记录
        </button>
      </div>

      {tab === "threshold" && (
        <div className="glass-card-static p-5 space-y-5">
          <p className="text-sm text-gray-500">
            设置用量达到限额的百分比或金额时触发预警通知。阈值修改后会影响后续新触发的提醒。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <NumberField
              label="个人用量预警阈值"
              value={settings.personal_threshold}
              suffix="%"
              max={100}
              hint="当个人本月用量达到限额的此百分比时触发。"
              onChange={(value) => setSettings({ ...settings, personal_threshold: value })}
            />
            <NumberField
              label="部门用量预警阈值"
              value={settings.dept_threshold}
              suffix="%"
              max={100}
              hint="当部门本月用量达到限额的此百分比时触发。"
              onChange={(value) => setSettings({ ...settings, dept_threshold: value })}
            />
            <NumberField
              label="公司用量预警阈值"
              value={settings.company_threshold}
              suffix="%"
              max={100}
              hint="当公司本月总用量达到限额的此百分比时触发。"
              onChange={(value) => setSettings({ ...settings, company_threshold: value })}
            />
            <NumberField
              label="异常用量检测阈值"
              value={settings.anomaly_threshold}
              suffix="元/小时"
              hint="单人 1 小时内消耗超过此金额时触发异常预警。"
              onChange={(value) => setSettings({ ...settings, anomaly_threshold: value })}
            />
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={handleSave} disabled={saving} className="glass-btn text-sm disabled:opacity-50">
              {saving ? "保存中..." : "保存设置"}
            </button>
          </div>
        </div>
      )}

      {tab === "feishu" && (
        <FeishuTab
          settings={settings}
          setSettings={setSettings}
          saving={saving}
          onSave={handleSave}
          onTestFeishu={handleTestFeishu}
          testing={testing}
          admins={admins}
          feishuChats={feishuChats}
          loadingFeishuChats={loadingFeishuChats}
          feishuChatsError={feishuChatsError}
          onRefreshFeishuChats={loadFeishuChats}
          onSendLeaderboard={handleSendLeaderboard}
          sendingLeaderboard={sendingLeaderboard}
        />
      )}

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
                    <th className="text-left">类型</th>
                    <th className="text-left">时间</th>
                    <th className="text-left">消息</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>{TYPE_LABELS[alert.type] || alert.type}</td>
                      <td>{new Date(alert.sentAt).toLocaleString("zh-CN")}</td>
                      <td className="max-w-2xl whitespace-pre-line break-words text-sm leading-6">{alert.message}</td>
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
