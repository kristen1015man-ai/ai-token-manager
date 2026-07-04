"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2, Zap } from "lucide-react";
import styles from "./studio.module.css";

// 任务 3 Hooks 可视化编辑器：GUI 编辑 settings.json 的 hooks 字段
// 事件类型：PreToolUse / PostToolUse / Notification / Stop / UserPromptSubmit / SessionStart / SessionEnd
// 每个 event 下若干 {matcher, hooks: [{type:"command", command}]}
// 安全：command 黑名单由 agent 端拦截（rm -rf /、format、mkfs、shutdown、curl/wget 外发到非本机等）

const HOOK_EVENTS: Array<{ id: string; label: string; desc: string }> = [
  { id: "PreToolUse",       label: "PreToolUse",       desc: "工具调用前（matcher 匹配工具名）" },
  { id: "PostToolUse",      label: "PostToolUse",      desc: "工具调用后（matcher 匹配工具名）" },
  { id: "Notification",     label: "Notification",     desc: "需要通知用户时" },
  { id: "Stop",             label: "Stop",             desc: "主 agent 响应结束" },
  { id: "UserPromptSubmit", label: "UserPromptSubmit", desc: "用户提交输入" },
  { id: "SessionStart",     label: "SessionStart",     desc: "会话开始" },
  { id: "SessionEnd",       label: "SessionEnd",       desc: "会话结束" },
];

interface HookCommand { type: "command"; command: string }
interface HookEntry { matcher: string; hooks: HookCommand[] }
type EventsMap = Record<string, HookEntry[]>;

interface HooksResponse {
  file: string;
  exists: boolean;
  events: EventsMap;
  note?: string;
}

interface Props {
  agentBase: string | null;
  agentAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

function cloneEvents(events: EventsMap): EventsMap {
  const out: EventsMap = {};
  for (const [evt, list] of Object.entries(events)) {
    out[evt] = list.map((e) => ({ matcher: e.matcher, hooks: e.hooks.map((h) => ({ ...h })) }));
  }
  return out;
}

export default function HooksPanel({ agentBase, agentAuthHeaders, onError, onNotice }: Props) {
  const [events, setEvents] = useState<EventsMap>({});
  const [original, setOriginal] = useState<EventsMap>({});
  const [file, setFile] = useState("");
  const [exists, setExists] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!agentBase) return;
    setLoading(true);
    try {
      const res = await fetch(`${agentBase}/claude/hooks`, {
        method: "GET",
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as HooksResponse;
      const ev = data.events && typeof data.events === "object" ? data.events : {};
      const cloned = cloneEvents(ev);
      setEvents(cloned);
      setOriginal(cloned);
      setFile(data.file || "");
      setExists(Boolean(data.exists));
      setNote(String(data.note || ""));
    } catch (err) {
      onError(err instanceof Error ? err.message : "读取 hooks 失败");
    } finally {
      setLoading(false);
    }
  }, [agentBase, agentAuthHeaders, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function addEntry(evt: string) {
    setEvents((prev) => {
      const next = cloneEvents(prev);
      const list = next[evt] ? next[evt] : (next[evt] = []);
      list.push({ matcher: evt === "PreToolUse" || evt === "PostToolUse" ? "Edit|Write" : "", hooks: [{ type: "command", command: "" }] });
      return next;
    });
  }

  function updateEntry(evt: string, idx: number, patch: Partial<HookEntry>) {
    setEvents((prev) => {
      const next = cloneEvents(prev);
      const list = next[evt] || [];
      const item = list[idx];
      if (!item) return prev;
      Object.assign(item, patch);
      return next;
    });
  }

  function updateCommand(evt: string, idx: number, hookIdx: number, cmd: string) {
    setEvents((prev) => {
      const next = cloneEvents(prev);
      const item = next[evt]?.[idx];
      if (!item) return prev;
      const hook = item.hooks[hookIdx];
      if (!hook) return prev;
      hook.command = cmd;
      return next;
    });
  }

  function addHook(evt: string, idx: number) {
    setEvents((prev) => {
      const next = cloneEvents(prev);
      const item = next[evt]?.[idx];
      if (!item) return prev;
      item.hooks.push({ type: "command", command: "" });
      return next;
    });
  }

  function removeHook(evt: string, idx: number, hookIdx: number) {
    setEvents((prev) => {
      const next = cloneEvents(prev);
      const item = next[evt]?.[idx];
      if (!item) return prev;
      // 至少保留一条 hook（空 entry 没意义；要删整个 entry 用 removeEntry）
      if (item.hooks.length <= 1) return prev;
      item.hooks.splice(hookIdx, 1);
      return next;
    });
  }

  function removeEntry(evt: string, idx: number) {
    setEvents((prev) => {
      const next = cloneEvents(prev);
      const list = next[evt] || [];
      list.splice(idx, 1);
      if (list.length === 0) delete next[evt];
      return next;
    });
  }

  async function saveAll() {
    if (!agentBase) return;
    // 本地基本校验：每个 entry 至少有一个非空 command
    for (const [evt, list] of Object.entries(events)) {
      for (const e of list) {
        if (!e.hooks.some((h) => h.command.trim())) {
          onError(`事件 ${evt} 下有空 command，请填上或删除该条`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${agentBase}/claude/hooks`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "hooks",
        }),
        body: JSON.stringify({ events }),
      });
      const body = await res.json().catch(() => ({} as { error?: string; events?: EventsMap; file?: string }));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const ev = body.events && typeof body.events === "object" ? body.events : events;
      const cloned = cloneEvents(ev);
      setEvents(cloned);
      setOriginal(cloned);
      if (body.file) setFile(body.file);
      setExists(true);
      onNotice("Hooks 已保存，重启 Claude Code / 本机 Agent 后生效");
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存 hooks 失败");
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(events) !== JSON.stringify(original);

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <Zap size={17} />
          <span>Hooks</span>
        </h3>
        <button
          type="button"
          className={styles.skillsInstallAll}
          onClick={() => void load()}
          disabled={loading}
          title="重新加载 hooks"
        >
          {loading ? <Loader2 size={12} className={styles.spin} /> : <RefreshCw size={12} />}
          刷新
        </button>
      </div>

      {!agentBase && (
        <div className={styles.inspectorEmpty}>本机 Agent 未连接，无法读取 hooks 配置。</div>
      )}

      {agentBase && (
        <>
          <p className={styles.skillsHint}>
            Hooks 在 Claude Code 生命周期事件触发时执行 shell 命令。{note || "保存后需重启 agent / Claude Code 才生效。"}
          </p>
          {file && (
            <p className={styles.hooksFileLine} title={file}>
              <span>配置文件：</span>
              <code>{file}</code>
              {exists ? <em className={styles.hooksFileExists}>已存在</em> : <em className={styles.hooksFileAbsent}>未创建</em>}
            </p>
          )}

          <div className={styles.hooksEvents}>
            {HOOK_EVENTS.map((evt) => {
              const list = events[evt.id] || [];
              return (
                <details key={evt.id} className={styles.hooksEventGroup} open={list.length > 0}>
                  <summary className={styles.hooksEventSummary}>
                    <span className={styles.hooksEventName}>{evt.label}</span>
                    <span className={styles.hooksEventDesc}>{evt.desc}</span>
                    <em className={styles.hooksEventCount}>{list.length}</em>
                  </summary>
                  <div className={styles.hooksEventBody}>
                    {list.length === 0 && (
                      <div className={styles.inspectorEmpty}>该事件下暂无 hook。</div>
                    )}
                    {list.map((entry, idx) => (
                      <div key={`${evt.id}-${idx}`} className={styles.hooksEntry}>
                        <div className={styles.hooksEntryHead}>
                          <label className={styles.hooksMatcherField}>
                            <span>matcher</span>
                            <input
                              type="text"
                              value={entry.matcher}
                              onChange={(e) => updateEntry(evt.id, idx, { matcher: e.target.value })}
                              placeholder={evt.id === "PreToolUse" || evt.id === "PostToolUse" ? "例如：Edit|Write（留空匹配全部）" : "（通常留空）"}
                            />
                          </label>
                          <button
                            type="button"
                            className={styles.sessionDelete}
                            onClick={() => removeEntry(evt.id, idx)}
                            title="删除此 hook"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <div className={styles.hooksCommandList}>
                          {entry.hooks.map((hook, hookIdx) => (
                            <div key={hookIdx} className={styles.hooksEntryHead}>
                              <label className={styles.hooksCommandField}>
                                <span>command {entry.hooks.length > 1 ? `#${hookIdx + 1}` : ""}</span>
                                <input
                                  type="text"
                                  value={hook.command}
                                  onChange={(e) => updateCommand(evt.id, idx, hookIdx, e.target.value)}
                                  placeholder="例如：echo 'tool ran' >> /tmp/claude.log"
                                  className={styles.hooksCommandInput}
                                />
                              </label>
                              <button
                                type="button"
                                className={styles.sessionDelete}
                                onClick={() => removeHook(evt.id, idx, hookIdx)}
                                title={entry.hooks.length <= 1 ? "至少保留一条命令（要删整条 entry 请点上方删除）" : "删除此命令"}
                                disabled={entry.hooks.length <= 1}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className={styles.hooksAddBtn}
                            onClick={() => addHook(evt.id, idx)}
                          >
                            <Plus size={12} /> 添加命令
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={styles.hooksAddBtn}
                      onClick={() => addEntry(evt.id)}
                    >
                      <Plus size={12} /> 添加 hook
                    </button>
                  </div>
                </details>
              );
            })}
          </div>

          <div className={styles.hooksFooter}>
            <span className={dirty ? styles.hooksDirty : styles.hooksClean}>{dirty ? "未保存" : "已保存"}</span>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => void saveAll()}
              disabled={saving || !dirty}
            >
              {saving ? <Loader2 size={13} className={styles.spin} /> : <Save size={13} />}
              保存全部
            </button>
          </div>
        </>
      )}
    </div>
  );
}
