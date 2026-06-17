"use client";

/** 预警管理页 — 飞书通知配置 Tab */
import { type AlertSettings, type AdminOption, NOTIFY_TYPE_OPTIONS } from "./alert-types";
import AdminMultiSelect from "@/components/AdminMultiSelect";
import GlassSelect from "@/components/GlassSelect";

interface FeishuTabProps {
  settings: AlertSettings;
  setSettings: (s: AlertSettings) => void;
  saving: boolean;
  onSave: () => void;
  onTestFeishu: () => void;
  testing: boolean;
  /** 管理员列表（供多选） */
  admins: AdminOption[];
}

export default function FeishuTab({
  settings,
  setSettings,
  saving,
  onSave,
  onTestFeishu,
  testing,
  admins,
}: FeishuTabProps) {
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

  /** 解析 JSON 数组字符串为 string[] */
  const parseRecipients = (key: string): string[] => {
    try {
      const val = (settings as unknown as Record<string, string>)[key] || "[]";
      return JSON.parse(val);
    } catch {
      return [];
    }
  };

  /** 更新某个接收人列表 */
  const updateRecipients = (key: string, ids: string[]) => {
    setSettings({ ...settings, [key]: JSON.stringify(ids) });
  };

  const enabledTypes = new Set(settings.feishu_notify_types.split(",").filter(Boolean));

  return (
    <div className="glass-card-static p-5 space-y-5">
      <p className="text-sm text-gray-500">
        通过飞书应用机器人发送通知，支持按类型选择接收管理员。
      </p>

      {/* 总开关 */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50 border border-gray-100">
        <div>
          <p className="font-medium text-gray-700">启用飞书通知</p>
          <p className="text-xs text-gray-400 mt-0.5">
            开启后，预警触发时自动通过飞书应用机器人推送通知
          </p>
        </div>
        <button
          onClick={toggleEnabled}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            settings.feishu_notify_enabled === "true" ? "bg-indigo-600" : "bg-gray-300"
          }`}
        >
          <span
            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
            style={{
              left: settings.feishu_notify_enabled === "true" ? "26px" : "2px",
            }}
          />
        </button>
      </div>

      {/* 通知类型设置表格 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          通知类型与接收人
        </label>
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_80px_1fr] gap-2 px-4 py-2 bg-gray-50/80 text-xs font-medium text-gray-500 border-b border-gray-100">
            <span>通知类型</span>
            <span className="text-center">开关</span>
            <span>接收人</span>
          </div>
          {/* 每种类型一行 */}
          {NOTIFY_TYPE_OPTIONS.map((opt, idx) => {
            const active = enabledTypes.has(opt.key);
            const isLast = idx === NOTIFY_TYPE_OPTIONS.length - 1;
            return (
              <div
                key={opt.key}
                className={`grid grid-cols-[1fr_80px_1fr] gap-2 items-center px-4 py-3 ${
                  !isLast ? "border-b border-gray-50" : ""
                }`}
              >
                {/* 类型信息 */}
                <div>
                  <p className="text-sm text-gray-700">{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>

                {/* 开关 */}
                <div className="flex justify-center">
                  <button
                    onClick={() => toggleNotifyType(opt.key)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      active ? "bg-indigo-500" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                      style={{ left: active ? "22px" : "2px" }}
                    />
                  </button>
                </div>

                {/* 接收人 */}
                <div>
                  {!opt.hasRecipients ? (
                    <span className="text-xs text-gray-400">自动发给个人私聊</span>
                  ) : (
                    <AdminMultiSelect
                      admins={admins}
                      selected={parseRecipients(opt.recipientsKey!)}
                      onChange={(ids) => updateRecipients(opt.recipientsKey!, ids)}
                      placeholder="选择管理员"
                      disabled={!active}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          接收人为空时，默认通知所有管理员
        </p>
      </div>

      {/* 排行榜设置 */}
      <div className="border-t border-gray-100 pt-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-gray-700">🏆 排行榜定时发送</p>
            <p className="text-xs text-gray-400 mt-0.5">
              定期发送用量排行榜到指定飞书群组
            </p>
          </div>
          <button
            onClick={() =>
              setSettings({
                ...settings,
                leaderboard_enabled:
                  settings.leaderboard_enabled === "true" ? "false" : "true",
              })
            }
            className={`relative w-12 h-6 rounded-full transition-colors ${
              settings.leaderboard_enabled === "true" ? "bg-indigo-600" : "bg-gray-300"
            }`}
          >
            <span
              className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
              style={{
                left: settings.leaderboard_enabled === "true" ? "26px" : "2px",
              }}
            />
          </button>
        </div>

        {settings.leaderboard_enabled === "true" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pl-0">
            {/* 发送频率 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                发送频率
              </label>
              <GlassSelect
                value={settings.leaderboard_schedule}
                onChange={(v) =>
                  setSettings({ ...settings, leaderboard_schedule: v })
                }
                options={[
                  { value: "disabled", label: "禁用" },
                  { value: "weekly", label: "每周" },
                  { value: "monthly", label: "每月" },
                ]}
                placeholder="发送频率"
                className="w-full text-sm"
              />
            </div>

            {/* 发送日期 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                发送日期
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={settings.leaderboard_send_day}
                  onChange={(e) =>
                    setSettings({ ...settings, leaderboard_send_day: e.target.value })
                  }
                  className="glass-input w-20 text-sm"
                />
                <span className="text-xs text-gray-400">号</span>
              </div>
            </div>

            {/* 群组 chat_id */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                群组 Chat ID
              </label>
              <input
                type="text"
                value={(() => {
                  try {
                    const ids = JSON.parse(settings.leaderboard_chat_ids || "[]");
                    return ids.join(", ");
                  } catch {
                    return "";
                  }
                })()}
                onChange={(e) => {
                  const ids = e.target.value
                    .split(/[,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  setSettings({ ...settings, leaderboard_chat_ids: JSON.stringify(ids) });
                }}
                placeholder="oc_xxxxx, oc_yyyyy"
                className="glass-input w-full text-sm"
              />
              <p className="text-xs text-gray-400 mt-0.5">多个群组用逗号分隔</p>
            </div>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
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
