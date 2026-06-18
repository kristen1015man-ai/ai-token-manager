"use client";

import AdminMultiSelect from "@/components/AdminMultiSelect";
import Avatar from "@/components/Avatar";
import GlassSelect from "@/components/GlassSelect";
import {
  type AdminOption,
  type AlertSettings,
  type FeishuChatOption,
  NOTIFY_TYPE_OPTIONS,
} from "./alert-types";

interface FeishuTabProps {
  settings: AlertSettings;
  setSettings: (s: AlertSettings) => void;
  saving: boolean;
  onSave: () => void;
  onTestFeishu: () => void;
  testing: boolean;
  admins: AdminOption[];
  feishuChats: FeishuChatOption[];
  loadingFeishuChats: boolean;
  feishuChatsError: string | null;
  onRefreshFeishuChats: () => void;
  onSendLeaderboard: () => void;
  sendingLeaderboard: boolean;
}

function parseJsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function encodeChatIds(input: string): string {
  const ids = input
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return JSON.stringify([...new Set(ids)]);
}

export default function FeishuTab({
  settings,
  setSettings,
  saving,
  onSave,
  onTestFeishu,
  testing,
  admins,
  feishuChats,
  loadingFeishuChats,
  feishuChatsError,
  onRefreshFeishuChats,
  onSendLeaderboard,
  sendingLeaderboard,
}: FeishuTabProps) {
  const enabledTypes = new Set(settings.feishu_notify_types.split(",").filter(Boolean));
  const leaderboardChatIds = parseJsonList(settings.leaderboard_chat_ids);
  const leaderboardEnabled = settings.leaderboard_enabled === "true";
  const leaderboardCanSend =
    leaderboardEnabled &&
    settings.leaderboard_schedule !== "disabled" &&
    leaderboardChatIds.length > 0 &&
    !saving &&
    !sendingLeaderboard;

  const toggleNotifyType = (key: string) => {
    const current = settings.feishu_notify_types.split(",").filter(Boolean);
    const next = current.includes(key)
      ? current.filter((type) => type !== key)
      : [...current, key];
    setSettings({ ...settings, feishu_notify_types: next.join(",") });
  };

  const updateRecipients = (key: string, ids: string[]) => {
    setSettings({ ...settings, [key]: JSON.stringify(ids) });
  };

  const parseRecipients = (key: string): string[] => {
    return parseJsonList((settings as unknown as Record<string, string>)[key] || "[]");
  };

  const updateLeaderboardChatIds = (ids: string[]) => {
    setSettings({ ...settings, leaderboard_chat_ids: JSON.stringify([...new Set(ids)]) });
  };

  const toggleLeaderboardChat = (chatId: string) => {
    updateLeaderboardChatIds(
      leaderboardChatIds.includes(chatId)
        ? leaderboardChatIds.filter((id) => id !== chatId)
        : [...leaderboardChatIds, chatId]
    );
  };

  const knownChatIds = new Set(feishuChats.map((chat) => chat.chatId));
  const manualOnlyChatIds = leaderboardChatIds.filter((id) => !knownChatIds.has(id));

  const sendDayLabel = settings.leaderboard_schedule === "weekly" ? "发送星期" : "发送日期";
  const sendDayHint =
    settings.leaderboard_schedule === "weekly"
      ? "1=周一，7=周日"
      : "每月几号发送，支持 1-28";
  const sendDayMax = settings.leaderboard_schedule === "weekly" ? 7 : 28;

  return (
    <div className="glass-card-static p-5 space-y-5">
      <p className="text-sm text-gray-500">
        通过飞书应用机器人发送通知。个人预警会发给员工本人，管理类预警可指定管理员接收。
      </p>

      <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50 border border-gray-100">
        <div>
          <p className="font-medium text-gray-700">启用飞书通知</p>
          <p className="text-xs text-gray-400 mt-0.5">
            开启后，预警触发时自动通过飞书应用机器人推送通知。
          </p>
        </div>
        <button
          type="button"
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
            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
            style={{ left: settings.feishu_notify_enabled === "true" ? "26px" : "2px" }}
          />
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">通知类型与接收人</label>
        <div className="border border-gray-100 rounded-xl overflow-visible">
          <div className="grid grid-cols-[1fr_80px_1fr] gap-2 px-4 py-2 bg-gray-50/80 text-xs font-medium text-gray-500 border-b border-gray-100">
            <span>通知类型</span>
            <span className="text-center">开关</span>
            <span>接收人</span>
          </div>
          {NOTIFY_TYPE_OPTIONS.map((opt, index) => {
            const active = enabledTypes.has(opt.key);
            const isLast = index === NOTIFY_TYPE_OPTIONS.length - 1;
            return (
              <div
                key={opt.key}
                className={`grid grid-cols-[1fr_80px_1fr] gap-2 items-center px-4 py-3 ${
                  !isLast ? "border-b border-gray-50" : ""
                }`}
              >
                <div>
                  <p className="text-sm text-gray-700">{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>
                <div className="flex justify-center">
                  <button
                    type="button"
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
                <div>
                  {!opt.hasRecipients ? (
                    <span className="text-xs text-gray-400">自动发给本人私聊</span>
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
          管理类接收人为空时，默认通知所有管理员。
        </p>
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">排行榜定时发送</p>
            <p className="text-xs text-gray-400 mt-0.5">
              定期发送员工 AI 用量排行榜到指定飞书群组。群组 Chat ID 可在这里在线配置。
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings({
                ...settings,
                leaderboard_enabled: leaderboardEnabled ? "false" : "true",
              })
            }
            className={`relative w-12 h-6 rounded-full transition-colors ${
              leaderboardEnabled ? "bg-indigo-600" : "bg-gray-300"
            }`}
          >
            <span
              className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
              style={{ left: leaderboardEnabled ? "26px" : "2px" }}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[180px_180px_1fr] gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">发送频率</label>
            <GlassSelect
              value={settings.leaderboard_schedule}
              onChange={(value) => setSettings({ ...settings, leaderboard_schedule: value })}
              options={[
                { value: "disabled", label: "禁用" },
                { value: "weekly", label: "每周" },
                { value: "monthly", label: "每月" },
              ]}
              placeholder="发送频率"
              className="w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{sendDayLabel}</label>
            <input
              type="number"
              min={1}
              max={sendDayMax}
              value={settings.leaderboard_send_day}
              onChange={(e) =>
                setSettings({ ...settings, leaderboard_send_day: e.target.value })
              }
              className="glass-input w-full text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">{sendDayHint}</p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-xs font-medium text-gray-600">选择机器人所在群组</label>
              <button
                type="button"
                onClick={onRefreshFeishuChats}
                disabled={loadingFeishuChats}
                className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors disabled:opacity-50"
              >
                {loadingFeishuChats ? "同步中..." : "同步群组"}
              </button>
            </div>

            {feishuChatsError && (
              <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {feishuChatsError}
              </p>
            )}

            <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100 bg-white/70">
              {feishuChats.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-gray-400">
                  {loadingFeishuChats ? "正在同步群组..." : "暂无可选群组"}
                </div>
              ) : (
                feishuChats.map((chat) => {
                  const selected = leaderboardChatIds.includes(chat.chatId);
                  return (
                    <button
                      key={chat.chatId}
                      type="button"
                      onClick={() => toggleLeaderboardChat(chat.chatId)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-rose-50/70 ${
                        selected ? "bg-rose-50/80" : ""
                      }`}
                    >
                      <Avatar name={chat.name} size="sm" avatarUrl={chat.avatar ?? undefined} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-700">{chat.name}</span>
                        <span className="block truncate text-xs text-gray-400">
                          {chat.chatId}
                          {chat.external ? " · 外部群" : ""}
                        </span>
                      </span>
                      <span
                        className={`h-4 w-4 flex-shrink-0 rounded border ${
                          selected ? "border-rose-500 bg-rose-500" : "border-gray-300 bg-white"
                        }`}
                        aria-hidden="true"
                      >
                        {selected && (
                          <svg viewBox="0 0 16 16" className="h-full w-full text-white">
                            <path
                              d="M4 8.2 6.7 11 12 5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {manualOnlyChatIds.length > 0 && (
              <p className="text-xs text-gray-400">
                已保存但本次同步未返回：{manualOnlyChatIds.join("、")}
              </p>
            )}
          </div>
        </div>

        <details className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">
            备用：手动填写 Chat ID
          </summary>
          <textarea
            value={leaderboardChatIds.join("\n")}
            onChange={(e) =>
              setSettings({ ...settings, leaderboard_chat_ids: encodeChatIds(e.target.value) })
            }
            placeholder={"oc_xxxxx\noc_yyyyy"}
            rows={3}
            className="glass-input mt-3 min-h-[86px] w-full resize-y text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            多个群组可一行一个，也可用逗号分隔。机器人必须已加入对应群组。
          </p>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSendLeaderboard}
            disabled={!leaderboardCanSend}
            className="px-5 py-2 text-sm rounded-xl font-medium transition-all duration-200 disabled:opacity-50 bg-amber-50 text-amber-700 border border-amber-100"
          >
            {sendingLeaderboard ? "发送中..." : "发送测试排行榜"}
          </button>
          {!leaderboardCanSend && (
            <span className="text-xs text-gray-400">
              发送前请启用排行榜、选择频率并选择群组。测试发送会自动保存当前设置。
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <button onClick={onSave} disabled={saving} className="glass-btn disabled:opacity-50">
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
