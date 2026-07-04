"use client";

import { useState } from "react";
import { ArrowRight, Bell, Bot, Check, KeyRound, Plug, Sparkles, X } from "lucide-react";
import {
  isNotifySupported,
  readNotifySettings,
  requestNotifyPermission,
  setNotifyEnabled,
} from "@/lib/studio-notify";
import styles from "./studio.module.css";

// 任务 5 首次启动引导
// localStorage "sparkloom.onboarded" 不存在 → 显示
// 步骤：欢迎 → 连接（显示 wsStatus + key 状态） → 选默认模型 → 开始

export const ONBOARDED_KEY = "sparkloom.onboarded";
export const DEFAULT_MODEL_KEY = "sparkloom.onboardDefaultModel";

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "yes";
  } catch {
    return false;
  }
}

export function markOnboarded(value: boolean) {
  try {
    if (value) localStorage.setItem(ONBOARDED_KEY, "yes");
    else localStorage.removeItem(ONBOARDED_KEY);
  } catch { /* ignore */ }
}

export function getOnboardedDefaultModel(): string | null {
  try {
    const v = localStorage.getItem(DEFAULT_MODEL_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

interface StudioModelLite {
  id: string;
  displayName?: string;
}

interface Props {
  agentOnline: boolean;
  keyConfigured: boolean;
  models: StudioModelLite[];
  fallbackDefaultModel: string;
  onPickModel: (modelId: string) => void;
  onClose: () => void;
}

const STEP_COUNT = 4;

export default function OnboardingModal({ agentOnline, keyConfigured, models, fallbackDefaultModel, onPickModel, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string>(fallbackDefaultModel);
  // 任务 3：通知开关，默认读取已有设置（首次为开）
  const [notifyOn, setNotifyOn] = useState<boolean>(() => readNotifySettings().enabled);

  function next() {
    if (step >= STEP_COUNT - 1) {
      finish();
    } else {
      setStep(step + 1);
    }
  }

  async function finish() {
    // 任务 3：完成引导时按用户选择写入通知开关；开启时主动申请权限
    setNotifyEnabled(notifyOn);
    if (notifyOn && isNotifySupported()) {
      try { await requestNotifyPermission(); } catch { /* 用户拒绝/无感 */ }
    }
    onPickModel(picked);
    markOnboarded(true);
    onClose();
  }

  function skip() {
    markOnboarded(true);
    onClose();
  }

  return (
    <div className={styles.onboardingOverlay} onClick={(e) => { if (e.target === e.currentTarget) skip(); }}>
      <div className={styles.onboardingModal} data-popover>
        <button type="button" className={styles.onboardingClose} onClick={skip} aria-label="跳过引导" title="跳过引导">
          <X size={16} />
        </button>

        <div className={styles.onboardingProgress}>
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`${styles.onboardingDot} ${i === step ? styles.onboardingDotActive : ""} ${i < step ? styles.onboardingDotDone : ""}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className={styles.onboardingStep}>
            <div className={styles.onboardingHeroIcon}><Sparkles size={28} /></div>
            <h2>欢迎使用 Sparkloom Studio</h2>
            <p>本机 Claude Code 的可视化操控台。在浏览器里管理任务、上下文、MCP、技能与 hooks，所有写操作都经本机 Agent 中转，密钥不落地。</p>
          </div>
        )}

        {step === 1 && (
          <div className={styles.onboardingStep}>
            <div className={styles.onboardingHeroIcon}><Plug size={28} /></div>
            <h2>连接本机 Agent</h2>
            <ul className={styles.onboardingChecklist}>
              <li className={agentOnline ? styles.onboardingCheckOk : styles.onboardingCheckPending}>
                {agentOnline ? <Check size={14} /> : <span className={styles.onboardingSpinner} />}
                <span>本机 Agent {agentOnline ? "已连接" : "等待连接…"}</span>
                {!agentOnline && <em>请打开桌面端或启动本地 agent</em>}
              </li>
              <li className={keyConfigured ? styles.onboardingCheckOk : styles.onboardingCheckPending}>
                {keyConfigured ? <Check size={14} /> : <KeyRound size={14} />}
                <span>Studio Key {keyConfigured ? "已配置" : "未配置"}</span>
                {!keyConfigured && <em>稍后在「模型」标签新建密钥</em>}
              </li>
            </ul>
          </div>
        )}

        {step === 2 && (
          <div className={styles.onboardingStep}>
            <div className={styles.onboardingHeroIcon}><Bot size={28} /></div>
            <h2>选择默认模型</h2>
            <p className={styles.onboardingP}>后续可在 ⌘K 命令面板或 Inspector「模型」标签随时切换。</p>
            <label className={styles.onboardingSelectWrap}>
              <select
                className={styles.onboardingSelect}
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
              >
                {models.length === 0 && <option value={fallbackDefaultModel}>{fallbackDefaultModel}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName || m.id}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {step === 3 && (
          <div className={styles.onboardingStep}>
            <div className={styles.onboardingHeroIcon}><Sparkles size={28} /></div>
            <h2>准备就绪</h2>
            <p>可以在 composer 中输入任务，或试试 / 唤出斜杠命令、⌘K 打开命令面板。设置里随时可以「重新引导」。</p>
            {isNotifySupported() && (
              <label className={styles.onboardingNotifyRow}>
                <Bell size={16} />
                <input
                  type="checkbox"
                  checked={notifyOn}
                  onChange={(e) => setNotifyOn(e.target.checked)}
                />
                <span>启用任务完成桌面通知</span>
                <em>（任务超过 30 秒或页面不在前台时提醒）</em>
              </label>
            )}
          </div>
        )}

        <div className={styles.onboardingFooter}>
          <button type="button" className={styles.onboardingSkip} onClick={skip}>跳过</button>
          <button type="button" className={styles.primaryAction} onClick={next}>
            {step === STEP_COUNT - 1 ? (
              <>
                <Check size={13} /> 开始使用
              </>
            ) : step === 1 && !agentOnline ? (
              <>
                仍要继续 <ArrowRight size={13} />
              </>
            ) : (
              <>
                下一步 <ArrowRight size={13} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
