"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  Boxes,
  ChevronDown,
  CheckCircle2,
  CircleAlert,
  Command,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Gauge,
  KeyRound,
  Laptop,
  Lock,
  MessageSquare,
  Mic,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  X,
  Zap,
  Wrench,
  Loader2,
  RotateCcw,
  Eraser,
  FilePen,
  AtSign,
  Pencil,
  Sun,
  Moon,
  FolderInput,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BRAND_NAME } from "@/lib/brand";
import { ApiError, fetchApi } from "@/lib/fetcher";
import styles from "./studio.module.css";

type QuotaStatus = "normal" | "warning" | "critical" | "exceeded";
type InspectorTab = "model" | "permissions" | "files" | "skills";
type ExecutionMode = "default" | "plan" | "auto";

interface StudioModel {
  id: string;
  claudeCodeId: string;
  displayName: string;
  provider: string;
  group: string;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion: number | null;
  currency: string;
}

interface ModelGroup {
  id: string;
  label: string;
  models: StudioModel[];
}

interface BootstrapData {
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    role: string;
  };
  quota: {
    todayCalls: number;
    todayTokens: number;
    todayCost: number;
    monthCalls: number;
    monthTokens: number;
    monthCost: number;
    monthlyQuota: number;
    remaining: number;
    percent: number;
    status: QuotaStatus;
  };
  gateway: {
    anthropicBaseUrl: string;
    openAIBaseUrl: string;
    modelDiscovery: boolean;
    env: Record<string, string>;
  };
  apiKeys: Array<{
    id: string;
    name: string;
    maskedKey: string;
    createdAt: number;
    lastUsedAt: number | null;
  }>;
  models: StudioModel[];
  modelGroups: ModelGroup[];
  sessions: StudioSession[];
  devices: Array<{
    id: string;
    name: string;
    platform: string | null;
    version: string | null;
    status: string;
    pairedAt: number;
    lastSeenAt: number | null;
  }>;
  agent: {
    expectedProtocolVersion: number;
    healthUrl: string;
    pairProtocol: string;
    reviewModeOnly: boolean;
  };
}

interface StudioSession {
  id: string;
  title: string;
  defaultModel: string | null;
  mode: string;
  createdAt?: number;
  updatedAt: number;
}

type MessageKind = "text" | "tool" | "status" | "result";
type ToolState = "running" | "done" | "error";

interface StudioMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  kind?: MessageKind;
  isStreaming?: boolean;
  toolName?: string;
  toolInput?: string;
  toolState?: ToolState;
  toolUseId?: string;
  statusText?: string;
  approvalId?: string;
  risk?: "safe" | "warn" | "danger";
  humanHint?: string;
  result?: string;
  isError?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  durationMs?: number;
  numTurns?: number;
  changedFiles?: number;
}

interface CreatedKeyResponse {
  apiKey: string;
  createdKey: {
    id: string;
    maskedKey: string;
    name: string;
    createdAt: number;
    lastUsedAt: number | null;
  };
  keys: BootstrapData["apiKeys"];
}

interface AgentEnvironment {
  platform: string;
  checks: Array<{
    name: string;
    ok: boolean;
    version: string | null;
    error: string | null;
  }>;
  installHints: Array<{
    name: string;
    command: string;
  }>;
}

interface AgentClaudeStatus {
  configured: boolean;
  file: string;
  baseUrl: string | null;
  tokenHash?: string | null;
  model: string | null;
  modelDiscovery: boolean;
}

interface AgentSkillsStatus {
  directory: string;
  bundled: string[];
  installed: string[];
  missing: string[];
}

interface AgentHealthStatus {
  ok: boolean;
  service: string;
  version: string;
  protocolVersion: number;
  authRequired?: boolean;
  tokenHash?: string | null;
}

type AgentStatus =
  | { state: "checking" }
  | {
      state: "online";
      version: string;
      protocolVersion: number;
      environment: AgentEnvironment | null;
      claude: AgentClaudeStatus | null;
      skills: AgentSkillsStatus | null;
    }
  | { state: "unpaired"; version: string; protocolVersion: number; message: string }
  | { state: "offline"; message: string };

interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: string;
}

type SpeechRecognitionConstructor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const BUILT_IN_SKILLS = [
  { name: "项目启动检测", key: "sparkloom-project-doctor" },
  { name: "代码审查", key: "sparkloom-code-review" },
  { name: "Bug 修复", key: "sparkloom-bug-fix" },
  { name: "前端 UI 审查", key: "sparkloom-frontend-ux-review" },
  { name: "Next.js 项目检查", key: "sparkloom-nextjs-check" },
  { name: "依赖安装排查", key: "sparkloom-dependency-repair" },
  { name: "生产发布检查", key: "sparkloom-release-check" },
  { name: "Git 提交说明", key: "sparkloom-git-summary" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  finance: "财务",
  dept_manager: "部门负责人",
  member: "成员",
};

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string; icon: typeof SlidersHorizontal }> = [
  { id: "model", label: "模型", icon: SlidersHorizontal },
  { id: "permissions", label: "执行", icon: ShieldCheck },
  { id: "files", label: "文件", icon: FolderOpen },
];

const EXECUTION_MODES: Array<{ id: ExecutionMode; label: string; title: string; description: string }> = [
  { id: "default", label: "Ask", title: "每次确认", description: "本地 SDK 遇到工具动作时按默认权限流程确认。" },
  { id: "plan", label: "Plan", title: "计划模式", description: "只做分析和计划，不直接改文件或执行高风险动作。" },
  { id: "auto", label: "Auto", title: "自动执行", description: "由本机 Agent 通过 Claude Agent SDK 自动推进任务。" },
];

const QUICK_ACTIONS = [
  { label: "Compact", value: "/compact", hint: "压缩当前上下文" },
  { label: "Clear", value: "/clear", hint: "清空当前上下文" },
  { label: "Init", value: "/init", hint: "初始化项目说明" },
  { label: "Status", value: "检查当前项目状态，并列出下一步建议。", hint: "项目状态" },
  { label: "Review", value: "审查当前项目的风险、权限、密钥和上线阻断项。", hint: "代码审查" },
  { label: "Fix", value: "根据当前错误定位原因，直接修复并验证。", hint: "修复问题" },
];

const AGENT_TOKEN_STORAGE_KEY = "sparkloom.agentToken";
const PROJECT_PATH_STORAGE_KEY = "sparkloom.projectPath";
const DEFAULT_AGENT_MAX_TURNS = 40;

function formatCurrency(value: number): string {
  return `¥${value.toFixed(4)}`;
}

function formatPercent(value: number): string {
  return `${Math.min(999, Math.max(0, value)).toFixed(1)}%`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelativeTime(value: number): string {
  if (!value) return "刚刚";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - value);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function quotaStatusLabel(status: QuotaStatus): string {
  switch (status) {
    case "exceeded":
      return "已超额";
    case "critical":
      return "严重";
    case "warning":
      return "预警";
    default:
      return "正常";
  }
}

function quotaStatusClass(status: QuotaStatus): string {
  switch (status) {
    case "exceeded":
      return styles.exceeded;
    case "critical":
      return styles.critical;
    case "warning":
      return styles.warning;
    default:
      return styles.normal;
  }
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role || "成员";
}

function normalizeExecutionMode(value: string | null | undefined): ExecutionMode {
  if (value === "plan") return "plan";
  if (value === "auto") return "auto";
  return "default";
}

function executionModeTitle(value: ExecutionMode): string {
  return EXECUTION_MODES.find((mode) => mode.id === value)?.title || "每次确认";
}

function buildEnvBlock(baseUrl: string, apiKey: string, model: string): string {
  return [
    `ANTHROPIC_BASE_URL=${baseUrl}`,
    `ANTHROPIC_AUTH_TOKEN=${apiKey}`,
    `ANTHROPIC_API_KEY=${apiKey}`,
    "CLAUDE_CONFIG_DIR=~/.sparkloom/claude-code",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1",
    model ? `ANTHROPIC_MODEL=${model}` : "",
  ].filter(Boolean).join("\n");
}

function buildPowerShellSnippet(baseUrl: string, apiKey: string, model: string): string {
  const lines = [
    `[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "${baseUrl}", "User")`,
    `[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "${apiKey}", "User")`,
    `[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "${apiKey}", "User")`,
    `[Environment]::SetEnvironmentVariable("CLAUDE_CONFIG_DIR", "$env:USERPROFILE\\.sparkloom\\claude-code", "User")`,
    `[Environment]::SetEnvironmentVariable("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", "1", "User")`,
  ];
  if (model) lines.push(`[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "${model}", "User")`);
  return lines.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskSecret(value: string): string {
  if (value.length <= 12) return "****";
  return `${value.slice(0, 12)}****${value.slice(-4)}`;
}

function redactSecretText(value: unknown, ...secrets: Array<string | null | undefined>): string {
  let text = String(value || "");
  text = text
    .replace(/sk-emp-[A-Za-z0-9_-]+/g, (match) => maskSecret(match))
    .replace(/(ANTHROPIC_AUTH_TOKEN\s*=\s*)[^\s\r\n]+/gi, "$1****")
    .replace(/(ANTHROPIC_API_KEY\s*=\s*)[^\s\r\n]+/gi, "$1****")
    .replace(/(Authorization:\s*Bearer\s+)[^\s\r\n]+/gi, "$1****");
  for (const secret of secrets) {
    const normalized = String(secret || "").trim();
    if (normalized.length < 8) continue;
    text = text.replace(new RegExp(escapeRegExp(normalized), "g"), maskSecret(normalized));
  }
  return text;
}

function buildAgentFailureMessage(body: Record<string, unknown>, responseStatus: number, output: string, stderr: string): string {
  const exitCode = body.exitCode === null || body.exitCode === undefined ? "" : `exit ${String(body.exitCode)}`;
  const candidates = [
    typeof body.error === "string" ? body.error : "",
    stderr,
    output,
    exitCode,
  ].map((item) => item.trim()).filter(Boolean);
  const detail = candidates.join("\n");
  if (/Reached max turns/i.test(detail)) {
    return [
      "Agent reached the task step limit before finishing.",
      "I have raised the default limit for new Agent runs. Try again with a narrower instruction, or switch to Plan first if the task needs several file edits.",
      detail,
    ].filter(Boolean).join("\n");
  }
  if (candidates.length > 0) return detail;
  return responseStatus > 0
    ? `Agent returned HTTP ${responseStatus}, but did not return a success result.`
    : "Agent did not return a success result.";
}

function humanizeStatus(raw: string): string {
  const s = String(raw || "").toLowerCase();
  if (!s) return "";
  if (s.includes("init")) return "正在初始化…";
  if (s.includes("compact")) return "正在压缩上下文…";
  if (s.includes("retry")) return "网络波动，正在重试…";
  if (s.includes("permission_denied") || s.includes("denied")) return "权限不足，操作已跳过";
  if (s.includes("started")) return "已启动，正在思考…";
  if (s.startsWith("sdk status:")) return raw.replace(/^sdk status:\s*/i, "");
  return raw;
}

function readStoredAgentToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(AGENT_TOKEN_STORAGE_KEY) || "";
}

function readAgentTokenFromHash(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return "";
  const params = new URLSearchParams(hash);
  const token = params.get("sparkloomAgentToken") || "";
  if (!token) return "";
  window.sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, token);
  params.delete("sparkloomAgentToken");
  const nextHash = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`);
  return token;
}

export default function StudioClient() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ state: "checking" });
  const [newKey, setNewKey] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [copied, setCopied] = useState("");
  const [sessions, setSessions] = useState<StudioSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const activeSessionIdRef = useRef("");
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  const agentRunningRef = useRef(false);
  const messagesForHotkeysRef = useRef<StudioMessage[]>([]);
  const respondingRef = useRef<string | null>(null);
  const cancelAgentRunRef = useRef<() => void>(() => {});
  const openMenuRef = useRef<() => void>(() => {});
  const respondApprovalRef = useRef<(id: string, d: "allow" | "deny") => void>(() => {});
  const [prompt, setPrompt] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const lastFailedContent = useRef("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("model");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("default");
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [savingStudioItem, setSavingStudioItem] = useState(false);
  const [agentActionBusy, setAgentActionBusy] = useState("");
  const [agentActionMessage, setAgentActionMessage] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentToken, setAgentToken] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "unsupported">("idle");
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string; createdAt: number }>>([]);
  const [rollbackMenuOpen, setRollbackMenuOpen] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [activeQuickIndex, setActiveQuickIndex] = useState(0);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [respondingApprovalId, setRespondingApprovalId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atFiles, setAtFiles] = useState<Array<{ name: string; isDir: boolean }>>([]);
  const [atLoading, setAtLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickBottomRef = useRef(true);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionConstructor> | null>(null);
  const agentSocketRef = useRef<WebSocket | null>(null);
  const agentRequestIdRef = useRef("");
  const desktopKeyConfiguredRef = useRef(false);

  async function load() {
    try {
      setError("");
      const next = await fetchApi<BootstrapData>("/api/studio/bootstrap");
      setData(next);
      const defaultModel = next.models.find((m) => /v4-pro|deepseek-v4-pro/i.test(m.claudeCodeId))?.claudeCodeId || next.models[0]?.claudeCodeId || "";
      setSelectedModel((current) => current || defaultModel);
      setSessions(next.sessions || []);
      setActiveSessionId((current) => current || next.sessions?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Studio 加载失败");
    }
  }

  async function loadSession(sessionId: string) {
    setCheckpoints([]);
    if (!sessionId) {
      setMessages([]);
      return;
    }
    try {
      const detail = await fetchApi<{
        session: StudioSession;
        messages: StudioMessage[];
      }>(`/api/studio/sessions/${encodeURIComponent(sessionId)}`);
      setMessages(detail.messages);
      setExecutionMode(normalizeExecutionMode(detail.session.mode));
      setSessions((current) => {
        const exists = current.some((item) => item.id === detail.session.id);
        return exists
          ? current.map((item) => item.id === detail.session.id ? detail.session : item)
          : [detail.session, ...current];
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "会话加载失败");
    }
  }

  async function checkAgent() {
    if (!data?.agent.healthUrl) return;
    setAgentStatus({ state: "checking" });
    const token = agentToken || readStoredAgentToken();
    const tokenHeaders: Record<string, string> = token ? { "x-sparkloom-agent-token": token } : {};
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(data.agent.healthUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as AgentHealthStatus;
      const agentBase = data.agent.healthUrl.replace(/\/health$/, "");
      let unauthorized = !token;
      async function fetchProtected<T>(path: string): Promise<T | null> {
        try {
          const response = await fetch(`${agentBase}${path}`, { method: "GET", headers: tokenHeaders, signal: controller.signal, cache: "no-store" });
          if (response.status === 401) {
            unauthorized = true;
            return null;
          }
          return response.ok ? response.json() as Promise<T> : null;
        } catch {
          return null;
        }
      }
      const [environment, claude, skills] = await Promise.all([
        fetchProtected<AgentEnvironment>("/environment"),
        fetchProtected<AgentClaudeStatus>("/claude/status"),
        fetchProtected<AgentSkillsStatus>("/skills/status"),
      ]);
      if (unauthorized) {
        window.sessionStorage.removeItem(AGENT_TOKEN_STORAGE_KEY);
        setAgentToken("");
        setAgentStatus({
          state: "unpaired",
          version: String(body.version || "unknown"),
          protocolVersion: Number(body.protocolVersion || 0),
          message: "Agent 已启动，但网页没有本机配对令牌。请从桌面 Sparkloom Studio 图标重新打开。",
        });
        return;
      }
      setAgentStatus({
        state: "online",
        version: String(body.version || "unknown"),
        protocolVersion: Number(body.protocolVersion || 0),
        environment,
        claude,
        skills,
      });
      // 桌面端 + 本机未配置 → 自动建密钥写入（零点击连上）
      void autoConfigureDesktopKey(claude);
    } catch {
      setAgentStatus({ state: "offline", message: "未检测到本机 Sparkloom Agent" });
    } finally {
      window.clearTimeout(timer);
    }
  }

  // 桌面端专用：本机 Agent 未配置 gateway 时自动新建设备密钥并写入，零点击连上。
  // 仅桌面端（preload 注入 window.sparkloomDesktop）触发；已配置或已尝试则跳过，避免循环。
  async function autoConfigureDesktopKey(claudeStatus: AgentClaudeStatus | null) {
    if (desktopKeyConfiguredRef.current) return;
    const isDesktop = !!(window as { sparkloomDesktop?: unknown }).sparkloomDesktop;
    if (!isDesktop || !data?.gateway?.anthropicBaseUrl) return;
    if (claudeStatus?.configured) {
      desktopKeyConfiguredRef.current = true;
      return;
    }
    // 提前置 true：防 await（createKey/configure）窗口内并发调用通过上面 check，重复建多个孤儿 key。
    // 429（没建 key）会在分支里重置 false 允许重试；其余失败保持 true 防孤儿累积。
    desktopKeyConfiguredRef.current = true;
    try {
      // agentBase 安全校验前置（在 createKey 之前）：只允许严格本机，避免 bootstrap 配错时白建 key + 明文外泄。
      // 注意：不放行任意 https（否则 https://attacker.com 也通过，安全检查形同虚设）。
      const agentBase = data.agent.healthUrl.replace(/\/health$/, "");
      let agentBaseOk = false;
      try {
        const u = new URL(agentBase);
        agentBaseOk = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
      } catch { agentBaseOk = false; }
      if (!agentBaseOk) {
        setConfirmDialog({
          message: `本机 Agent 地址异常（${agentBase}），自动配置中止。请检查 Agent 配置。`,
          onConfirm: () => setConfirmDialog(null),
        });
        return;
      }
      // 设备名（userAgentData 优先，fallback navigator.platform）
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const rawPlat = nav.userAgentData?.platform || navigator.platform || "";
      const platTag = /win/i.test(rawPlat) ? "Win" : /mac/i.test(rawPlat) ? "Mac" : "Linux";
      const user = (data?.user || {}) as { name?: string; email?: string };
      const userTag = (user.name || user.email || "user").toString().slice(0, 8).replace(/\s+/g, "");
      const deviceName = `Desktop-${platTag}-${userTag}`;
      const createKey = () => fetch("/api/user/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deviceName }),
      });
      let keyResp = await createKey();
      // 429 冷却：不阻塞、不自动重试（避免 confirmDialog 装载 loading 造成状态污染 + 取消按钮无效）。
      // 提示用户稍后重连；ref 不置（重连可重试），且 429 没建 key 不会累积。
      if (keyResp.status === 429) {
        desktopKeyConfiguredRef.current = false; // 429 没建 key，允许重连重试
        setConfirmDialog({
          message: "密钥创建冷却中（60 秒内建过）。请稍后点「重新连接」重试。",
          onConfirm: () => setConfirmDialog(null),
        });
        return;
      }
      // 400 上限（5 个）：引导删密钥（ref 未置，删完重连即重新自动配置）
      if (keyResp.status === 400) {
        setConfirmDialog({
          message: "密钥已达上限（5 个）。请到后台删除不用的密钥后回来点「重新连接」。",
          onConfirm: () => window.open("/dashboard#api-keys", "_blank"),
        });
        return;
      }
      // 401/403/500 等：明确提示（不静默）
      if (!keyResp.ok) {
        setConfirmDialog({
          message: `自动配置失败（HTTP ${keyResp.status}）。可在「写入配置」手动处理，或刷新页面重试。`,
          onConfirm: () => setConfirmDialog(null),
        });
        return;
      }
      const keyData = (await keyResp.json()) as { apiKey?: string; error?: string };
      if (!keyData.apiKey) return;
      // 写入本机 Agent 配置；校验 ok
      const token = agentToken || readStoredAgentToken();
      const configureResp = await fetch(`${agentBase}/claude/configure`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sparkloom-agent-token": token,
          "x-sparkloom-local-confirm": "configure-claude-code",
        },
        body: JSON.stringify({
          baseUrl: data.gateway.anthropicBaseUrl,
          token: keyData.apiKey,
          model: selectedModel || undefined,
        }),
      });
      if (!configureResp.ok) {
        // configure 失败：key 已建占名额。置 ref true 阻止自动重试累积孤儿，提示用户后台删该密钥。
        desktopKeyConfiguredRef.current = true;
        setConfirmDialog({
          message: "密钥已创建但写入本机失败（占了一个名额）。请到后台删除该密钥，或在「写入配置」手动处理。",
          onConfirm: () => window.open("/dashboard#api-keys", "_blank"),
        });
        return;
      }
      desktopKeyConfiguredRef.current = true; // 全部成功才置 true
      window.setTimeout(() => checkAgent(), 600);
    } catch (err) {
      // 网络/解析异常：明确提示（不静默吞），ref 不置（可重试）
      setConfirmDialog({
        message: `自动配置异常：${err instanceof Error ? err.message : "网络错误"}。请稍后点「重新连接」重试。`,
        onConfirm: () => setConfirmDialog(null),
      });
    }
  }

  useEffect(() => {
    load();
  }, []);

  // 同步 ref 给全局快捷键用（避免 effect 依赖 state 每帧重绑）
  useEffect(() => {
    agentRunningRef.current = agentRunning;
    messagesForHotkeysRef.current = messages;
  });

  // 点浮层外关闭（outside-click）——浮层打开时才绑，避免同次 click 打开即关
  useEffect(() => {
    if (!quickMenuOpen && !atMenuOpen && !rollbackMenuOpen && !projectPickerOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("[data-popover]")) return;
      setQuickMenuOpen(false);
      setAtMenuOpen(false);
      setRollbackMenuOpen(false);
      setProjectPickerOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [quickMenuOpen, atMenuOpen, rollbackMenuOpen, projectPickerOpen]);

  // 全局快捷键：Esc 中断、Y/N 审批（用 ref 读最新值，effect 只绑一次，不每帧重绑）
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape" && agentRunningRef.current) {
        e.preventDefault();
        cancelAgentRunRef.current();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (inField) return;
      const key = e.key.toLowerCase();
      if (key === "y" || key === "n") {
        const pending = [...messagesForHotkeysRef.current].reverse().find((m) => m.approvalId && m.toolState === "running");
        if (pending?.approvalId) {
          e.preventDefault();
          respondApprovalRef.current(pending.approvalId, key === "y" ? "allow" : "deny");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 流式输出自动滚动到底（用户手动上滚则不打扰）
  useEffect(() => {
    const el = streamRef.current;
    if (el && stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // ⌘K / Ctrl+K 命令面板
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
        setCommandQuery("");
        setCommandIndex(0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      agentSocketRef.current?.close();
      agentSocketRef.current = null;
      agentRequestIdRef.current = "";
    };
  }, []);

  useEffect(() => {
    const token = readAgentTokenFromHash() || readStoredAgentToken();
    if (token) setAgentToken(token);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setProjectPath(window.localStorage.getItem(PROJECT_PATH_STORAGE_KEY) || "");
    const savedTheme = window.localStorage.getItem("sparkloom.studioTheme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = projectPath.trim();
    if (value) {
      window.localStorage.setItem(PROJECT_PATH_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(PROJECT_PATH_STORAGE_KEY);
    }
  }, [projectPath]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setRecentProjects(JSON.parse(window.localStorage.getItem("sparkloom.recentProjects") || "[]"));
    } catch {
      // 忽略损坏的本地数据
    }
  }, []);

  useEffect(() => {
    if (data) checkAgent();
  }, [data?.agent.healthUrl, agentToken]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // 切换会话时取消当前运行的任务（单任务模型：保证状态一致，避免后台事件错位/丢弃）
  useEffect(() => {
    if (activeSessionId) {
      cancelAgentRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // 浮层关闭函数（给 outside-click 用）
  openMenuRef.current = () => {
    setQuickMenuOpen(false);
    setAtMenuOpen(false);
    setRollbackMenuOpen(false);
  };

  useEffect(() => {
    if (activeSessionId) loadSession(activeSessionId);
  }, [activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  useEffect(() => {
    if (activeSession) setExecutionMode(normalizeExecutionMode(activeSession.mode));
  }, [activeSession?.id, activeSession?.mode]);

  const selectedModelInfo = useMemo(() => {
    return data?.models.find((model) => model.claudeCodeId === selectedModel) || data?.models[0] || null;
  }, [data?.models, selectedModel]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(query));
  }, [sessions, sessionSearch]);

  const installedSkillSet = useMemo(() => {
    return new Set(agentStatus.state === "online" && agentStatus.skills ? agentStatus.skills.installed : []);
  }, [agentStatus]);

  const configText = data && newKey ? buildEnvBlock(data.gateway.anthropicBaseUrl, newKey, selectedModel) : "";
  const powerShellText = data && newKey ? buildPowerShellSnippet(data.gateway.anthropicBaseUrl, newKey, selectedModel) : "";

  async function createStudioKey() {
    setCreatingKey(true);
    setError("");
    try {
      const created = await fetchApi<CreatedKeyResponse>("/api/user/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sparkloom Studio" }),
      });
      setNewKey(created.apiKey);
      await load();
      setInspectorTab("model");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "新建密钥失败");
    } finally {
      setCreatingKey(false);
    }
  }

  function agentBaseUrl(): string | null {
    return data?.agent.healthUrl ? data.agent.healthUrl.replace(/\/health$/, "") : null;
  }

  function agentAuthHeaders(extra?: Record<string, string>): Record<string, string> {
    const token = agentToken || readStoredAgentToken();
    return token ? { ...(extra || {}), "x-sparkloom-agent-token": token } : { ...(extra || {}) };
  }

  function agentWebSocketUrl(baseUrl: string, token: string): string {
    const url = new URL("/ws", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    return url.toString();
  }

  async function configureLocalClaude() {
    const baseUrl = agentBaseUrl();
    if (!baseUrl || !data) return;
    if (!newKey) {
      setError("请先新建 Studio Key。明文 key 只会在创建后显示一次。");
      return;
    }
    if (!(agentToken || readStoredAgentToken())) {
      setError("请从桌面 Sparkloom Studio 图标重新打开页面，完成本机连接。");
      return;
    }

    setAgentActionBusy("configure");
    setAgentActionMessage("");
    setError("");
    try {
      const response = await fetch(`${baseUrl}/claude/configure`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "configure-claude-code",
        }),
        body: JSON.stringify({
          baseUrl: data.gateway.anthropicBaseUrl,
          token: newKey,
          model: selectedModel,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Agent HTTP ${response.status}`);
      setAgentActionMessage("已写入本机 Sparkloom 网关配置");
      setNewKey("");
      setCopied("");
      await checkAgent();
    } catch (err) {
      setError(redactSecretText(err instanceof Error ? err.message : "写入本机配置失败", newKey, agentToken || readStoredAgentToken()));
    } finally {
      setAgentActionBusy("");
    }
  }

  async function installLocalSkills() {
    const baseUrl = agentBaseUrl();
    if (!baseUrl) return;
    if (!(agentToken || readStoredAgentToken())) {
      setError("请从桌面 Sparkloom Studio 图标重新打开页面，完成本机连接。");
      return;
    }

    setAgentActionBusy("skills");
    setAgentActionMessage("");
    setError("");
    try {
      const response = await fetch(`${baseUrl}/skills/install`, {
        method: "POST",
        headers: agentAuthHeaders({ "x-sparkloom-local-confirm": "install-reviewed-skills" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Agent HTTP ${response.status}`);
      const count = Array.isArray(body.installed) ? body.installed.length : 0;
      setAgentActionMessage(`已安装 ${count} 个内置 skills`);
      await checkAgent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装内置 skills 失败");
    } finally {
      setAgentActionBusy("");
    }
  }

  async function updateExecutionMode(nextMode: ExecutionMode) {
    setExecutionMode(nextMode);
    if (!activeSessionId) return;
    setSessions((current) => current.map((session) => (
      session.id === activeSessionId ? { ...session, mode: nextMode } : session
    )));
    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(activeSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "执行模式保存失败");
    }
  }

  async function createSession() {
    setSavingStudioItem(true);
    setError("");
    try {
      const created = await fetchApi<{ session: StudioSession }>("/api/studio/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New task",
          defaultModel: selectedModel,
          mode: executionMode,
        }),
      });
      setSessions((current) => [created.session, ...current]);
      setActiveSessionId(created.session.id);
      setMessages([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "新建会话失败");
    } finally {
      setSavingStudioItem(false);
    }
  }

  async function deleteSession(sessionId: string, title: string) {
    if (!sessionId || savingStudioItem) return;
    setConfirmDialog({
      message: `删除会话「${title}」？此操作会同时删除该会话里的消息记录。`,
      onConfirm: () => doDeleteSession(sessionId),
    });
  }

  async function doDeleteSession(sessionId: string) {
    setSavingStudioItem(true);
    setError("");
    const previousSessions = sessions;
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    const nextActiveId = sessionId === activeSessionId ? nextSessions[0]?.id || "" : activeSessionId;
    setSessions(nextSessions);
    setActiveSessionId(nextActiveId);
    if (!nextActiveId) setMessages([]);

    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (nextActiveId) await loadSession(nextActiveId);
    } catch (err) {
      setSessions(previousSessions);
      setActiveSessionId(activeSessionId);
      setError(err instanceof ApiError ? err.message : "会话删除失败");
    } finally {
      setSavingStudioItem(false);
    }
  }

  async function sendMessage(contentArg?: string) {
    if (agentRunning) return;
    const content = (contentArg ?? prompt).trim();
    if (!content && attachments.length === 0) return;
    const pathTrim = projectPath.trim();
    if (pathTrim) {
      setRecentProjects((prev) => {
        const next = [pathTrim, ...prev.filter((x) => x !== pathTrim)].slice(0, 8);
        if (typeof window !== "undefined") window.localStorage.setItem("sparkloom.recentProjects", JSON.stringify(next));
        return next;
      });
    }
    lastFailedContent.current = content;
    setSavingStudioItem(true);
    setError("");
    try {
      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await fetchApi<{ session: StudioSession }>("/api/studio/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: content.slice(0, 48) || "File review",
            defaultModel: selectedModel,
            mode: executionMode,
          }),
        });
        sessionId = created.session.id;
        setSessions((current) => [created.session, ...current]);
        setActiveSessionId(sessionId);
      }

      // 编辑模式：删除编辑点消息及其后所有，再以新内容重发
      if (editingMsgId) {
        const editMsg = messages.find((m) => m.id === editingMsgId);
        const editCreatedAt = editMsg?.createdAt ?? 0;
        const editId = editingMsgId;
        setEditingMsgId(null);
        setMessages((current) => current.filter((m) => m.createdAt < editCreatedAt));
        try {
          await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}/messages?from=${encodeURIComponent(editId)}`, { method: "DELETE" });
        } catch {
          // 删除失败不阻塞重发
        }
      }

      const attachmentText = attachments.length > 0
        ? `\n\n附件：${attachments.map((file) => `${file.name} (${formatFileSize(file.size)})`).join("，")}`
        : "";
      const createdMessage = await fetchApi<{ message: StudioMessage }>(
        `/api/studio/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: `${content}${attachmentText}`.trim() }),
        }
      );
      setMessages((current) => [...current, createdMessage.message]);
      const completed = await runAgentTask(sessionId, `${content}${attachmentText}`.trim());
      if (completed) {
        setPrompt("");
        setAttachments([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "消息保存失败");
    } finally {
      setSavingStudioItem(false);
    }
  }

  async function saveAssistantMessage(sessionId: string, content: string, replaceLocalId?: string): Promise<StudioMessage> {
    const created = await fetchApi<{ message: StudioMessage }>(
      `/api/studio/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content }),
      }
    );
    if (sessionId === activeSessionIdRef.current) {
      setMessages((current) => replaceLocalId
        ? current.map((message) => message.id === replaceLocalId ? created.message : message)
        : [...current, created.message]
      );
    }
    return created.message;
  }

  async function runAgentTask(sessionId: string, content: string): Promise<boolean> {
    const baseUrl = agentBaseUrl();
    if (!baseUrl || agentStatus.state !== "online") {
      await saveAssistantMessage(sessionId, "本地 Sparkloom Agent 未连接。请先打开本地 Agent，再重新发送任务。");
      return false;
    }
    if (!agentStatus.claude?.configured) {
      await saveAssistantMessage(sessionId, "Sparkloom 网关还没有配置。请在右侧模型面板新建 Studio Key，并写入本机配置。");
      return false;
    }
    if (!(agentToken || readStoredAgentToken())) {
      await saveAssistantMessage(sessionId, "本机连接需要重新确认。请从桌面 Sparkloom Studio 图标重新打开页面。");
      return false;
    }

    const token = agentToken || readStoredAgentToken();
    const streamMessageId = `stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let streamText = "";
    let settled = false;
    const currentToken = token;

    setRunningSessionId(sessionId);
    if (sessionId === activeSessionIdRef.current) {
      setMessages((current) => [
        ...current,
        {
          id: streamMessageId,
          role: "assistant",
          content: "Agent 正在连接本机 SDK...",
          createdAt: Math.floor(Date.now() / 1000),
        },
      ]);
    }

    const streamBuffer = { current: "" };
    let flushScheduled = false;
    const updateStreamMessage = (next: string) => {
      if (sessionId !== activeSessionIdRef.current) return;
      streamBuffer.current = next;
      if (flushScheduled) return;
      flushScheduled = true;
      requestAnimationFrame(() => {
        flushScheduled = false;
        const text = streamBuffer.current || "Agent 正在处理...";
        setMessages((current) => current.map((message) => (
          message.id === streamMessageId ? { ...message, content: text } : message
        )));
      });
    };

    const finishWithMessage = async (message: string, ok: boolean) => {
      if (settled) return ok;
      settled = true;
      await saveAssistantMessage(sessionId, message, streamMessageId);
      return ok;
    };

    setAgentActionBusy("run");
    setAgentRunning(true);
    setAgentActionMessage(`Agent 正在以 ${executionModeTitle(executionMode)} 模式执行`);

    return await new Promise<boolean>((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(agentWebSocketUrl(baseUrl, token));
      } catch (err) {
        const message = redactSecretText(err instanceof Error ? err.message : "Agent WebSocket 创建失败", newKey, currentToken);
        void finishWithMessage(`Agent failed:\n${message}`, false).then(resolve);
        setAgentActionBusy("");
        setAgentRunning(false);
        return;
      }

      agentSocketRef.current = socket;
      agentRequestIdRef.current = requestId;

      const finalize = async (ok: boolean, message: string) => {
        const redacted = redactSecretText(message, newKey, currentToken).trim();
        const finalMessage = ok
          ? (redacted || "Agent 已完成，但没有返回文本输出。")
          : `Agent failed:\n${redacted || "Agent 执行失败"}`;
        const result = await finishWithMessage(finalMessage, ok);
        setAgentActionBusy("");
        setAgentRunning(false);
        setRunningSessionId((cur) => (cur === sessionId ? null : cur));
        agentSocketRef.current = null;
        agentRequestIdRef.current = "";
        resolve(result);
      };

      socket.onopen = () => {
        setAgentActionMessage("Agent SDK 已连接，正在启动任务");
        updateStreamMessage("Agent SDK 已连接，正在启动任务...");
        socket.send(JSON.stringify({
          type: "run",
          requestId,
          prompt: content,
          mode: executionMode,
          model: selectedModel,
          cwd: projectPath.trim(),
          maxTurns: DEFAULT_AGENT_MAX_TURNS,
        }));
      };

      socket.onmessage = (event) => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(String(event.data || "{}")) as Record<string, unknown>;
        } catch {
          void finalize(false, "Agent WebSocket 返回了无法解析的数据。");
          socket.close();
          return;
        }
        if (body.requestId && body.requestId !== requestId) return;
        const type = String(body.type || "");
        // 会话并发：任务不在当前会话时，跳过 UI 更新（任务后台继续，结果已存库，回切可看），仅放行 result/error 以触发存库收尾
        if (sessionId !== activeSessionIdRef.current && type !== "result" && type !== "error") return;
        if (type === "ready") {
          setAgentActionMessage("Agent WebSocket 已就绪");
          return;
        }
        if (type === "start") {
          setAgentActionMessage(`Agent 正在以 ${executionModeTitle(executionMode)} 模式执行`);
          return;
        }
        if (type === "status") {
          const text = humanizeStatus(redactSecretText(String(body.text || ""), newKey, currentToken));
          if (text) setAgentActionMessage(text);
          return;
        }
        if (type === "tool") {
          const tool = redactSecretText(String(body.tool || "tool"), newKey, currentToken);
          const input = redactSecretText(String(body.input || ""), newKey, currentToken).slice(0, 500);
          const toolUseId = String(body.toolUseId || "");
          setAgentActionMessage(`调用工具：${tool}`);
          setMessages((current) => {
            if (toolUseId) {
              const idx = current.findIndex((m) => m.kind === "tool" && m.toolUseId === toolUseId);
              if (idx >= 0) {
                return current.map((m, i) => (i === idx ? { ...m, toolName: tool, toolInput: input } : m));
              }
            }
            return [...current, {
              id: `t_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              role: "assistant" as const,
              content: "",
              createdAt: Math.floor(Date.now() / 1000),
              kind: "tool" as const,
              toolName: tool,
              toolInput: input,
              toolState: "done" as const,
              toolUseId,
            }];
          });
          return;
        }
        if (type === "approval_request") {
          const approvalId = String(body.approvalId || "");
          const toolName = redactSecretText(String(body.toolName || "tool"), newKey, currentToken);
          const input = redactSecretText(String(body.input || ""), newKey, currentToken).slice(0, 500);
          const riskRaw = String(body.risk || "warn");
          const risk = (riskRaw === "safe" || riskRaw === "warn" || riskRaw === "danger" ? riskRaw : "warn") as "safe" | "warn" | "danger";
          const humanHint = redactSecretText(String(body.humanHint || ""), newKey, currentToken);
          setAgentActionMessage(`等待你确认：${humanHint || toolName}`);
          setMessages((current) => [...current, {
            id: `ap_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            role: "assistant" as const,
            content: "",
            createdAt: Math.floor(Date.now() / 1000),
            kind: "tool" as const,
            toolName,
            toolInput: input,
            toolState: "running" as const,
            approvalId,
            toolUseId: approvalId,
            risk,
            humanHint,
          }]);
          return;
        }
        if (type === "tool_result") {
          const toolUseId = String(body.toolUseId || "");
          const rc = redactSecretText(String(body.content || ""), newKey, currentToken).slice(0, 1500);
          const isError = Boolean(body.isError);
          setMessages((current) => current.map((m) =>
            (m.kind === "tool" && m.toolUseId && m.toolUseId === toolUseId)
              ? { ...m, result: rc, isError, toolState: isError ? ("error" as const) : ("done" as const) }
              : m
          ));
          return;
        }
        if (type === "checkpoint") {
          const cp = { id: String(body.checkpointId || ""), label: String(body.label || ""), createdAt: Number(body.createdAt || Math.floor(Date.now() / 1000)) };
          if (cp.id) setCheckpoints((prev) => [...prev, cp]);
          return;
        }
        if (type === "rolled") {
          setAgentActionMessage("已回滚到历史状态");
          setMessages((current) => [...current, {
            id: `sys_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            role: "assistant" as const,
            content: "✅ 已回滚到该时间点的文件状态（对话记录保留）",
            createdAt: Math.floor(Date.now() / 1000),
            kind: "status" as const,
            statusText: "已回滚",
          }]);
          return;
        }
        if (type === "usage") {
          setMessages((current) => {
            let lastUser = -1;
            for (let i = current.length - 1; i >= 0; i -= 1) {
              if (current[i].role === "user") { lastUser = i; break; }
            }
            const turned = lastUser >= 0 ? current.slice(lastUser + 1) : current;
            const files = new Set<string>();
            turned.forEach((m) => {
              if (m.kind === "tool" && /^(Edit|Write|MultiEdit)$/.test(String(m.toolName || ""))) {
                const info = parseEditInput(m.toolInput);
                if (info?.filePath) files.add(info.filePath);
              }
            });
            return [...current, {
              id: `ru_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              role: "assistant" as const,
              content: "",
              createdAt: Math.floor(Date.now() / 1000),
              kind: "result" as const,
              usage: { inputTokens: Number(body.inputTokens || 0), outputTokens: Number(body.outputTokens || 0), costUsd: Number(body.costUsd || 0) },
              durationMs: body.durationMs ? Number(body.durationMs) : undefined,
              numTurns: body.numTurns ? Number(body.numTurns) : undefined,
              changedFiles: files.size || undefined,
            }];
          });
          return;
        }
        if (type === "delta") {
          const text = redactSecretText(String(body.text || ""), newKey, currentToken);
          if (!text) return;
          streamText += text;
          updateStreamMessage(streamText);
          return;
        }
        if (type === "error") {
          void finalize(false, String(body.error || "Agent WebSocket 执行失败"));
          socket.close();
          return;
        }
        if (type === "result") {
          const ok = body.ok !== false;
          const output = redactSecretText(String(body.output || streamText || ""), newKey, currentToken);
          const stderr = redactSecretText(String(body.stderr || body.error || ""), newKey, currentToken);
          setAgentActionMessage(ok ? "Agent 执行完成" : "Agent 执行失败");
          void finalize(ok, ok ? output : buildAgentFailureMessage(body, 0, output, stderr));
          socket.close();
        }
      };

      socket.onerror = () => {
        void finalize(false, "Agent WebSocket 连接失败。请确认本地 Sparkloom Agent 正在运行。");
      };

      socket.onclose = () => {
        if (settled) return;
        void finalize(false, "Agent WebSocket 已断开，任务没有返回完成结果。");
      };
    });
  }

  const cancelAgentRun = useCallback(() => {
    const socket = agentSocketRef.current;
    const requestId = agentRequestIdRef.current;
    if (socket && socket.readyState === WebSocket.OPEN && requestId) {
      socket.send(JSON.stringify({ type: "cancel", requestId }));
    }
    socket?.close();
    agentSocketRef.current = null;
    agentRequestIdRef.current = "";
    setAgentRunning(false);
    setAgentActionBusy("");
    setAgentActionMessage("Agent 任务已取消");
  }, []);

  const respondApproval = useCallback((approvalId: string, decision: "allow" | "deny") => {
    if (!approvalId || respondingRef.current) return;
    respondingRef.current = approvalId;
    setRespondingApprovalId(approvalId);
    setMessages((current) => current.map((m) =>
      m.approvalId === approvalId ? { ...m, toolState: decision === "allow" ? "done" : "error", approvalId: undefined } : m
    ));
    const socket = agentSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "approval_respond", approvalId, decision }));
    }
    window.setTimeout(() => { respondingRef.current = null; setRespondingApprovalId(null); }, 800);
  }, []);

  cancelAgentRunRef.current = cancelAgentRun;
  respondApprovalRef.current = respondApproval;

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof window !== "undefined") window.localStorage.setItem("sparkloom.studioTheme", next);
  }

  function pickProject(path: string) {
    setProjectPath(path);
    setProjectPickerOpen(false);
  }

  function toggleToolExpand(id: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openAtMenu() {
    if (atMenuOpen) { setAtMenuOpen(false); return; }
    const baseUrl = agentBaseUrl();
    const token = agentToken || readStoredAgentToken();
    const dir = projectPath.trim();
    if (!baseUrl || !token || !dir) {
      setError("请先填写项目目录并连接本机 Agent，再用 @ 引用文件");
      return;
    }
    setAtMenuOpen(true);
    setAtLoading(true);
    try {
      const res = await fetch(`${baseUrl}/files?path=${encodeURIComponent(dir)}`, { headers: agentAuthHeaders(), cache: "no-store" });
      const body = await res.json() as { files?: Array<{ name: string; isDir: boolean }> };
      setAtFiles(Array.isArray(body.files) ? body.files : []);
    } catch {
      setAtFiles([]);
    } finally {
      setAtLoading(false);
    }
  }

  function insertFileRef(name: string) {
    setPrompt((p) => `${p}${p && !p.endsWith(" ") ? " " : ""}@${name}`);
    setAtMenuOpen(false);
  }

  function startEditMessage(msg: StudioMessage) {
    setPrompt(msg.content);
    setEditingMsgId(msg.id);
  }

  async function clearOtherSessions() {
    const others = sessions.filter((s) => s.id !== activeSessionId);
    if (others.length === 0) return;
    setConfirmDialog({
      message: `清理除当前会话外的 ${others.length} 个会话？此操作不可撤销。`,
      onConfirm: () => doClearOtherSessions(others),
    });
  }

  async function doClearOtherSessions(others: StudioSession[]) {
    setSessions((current) => current.filter((s) => s.id === activeSessionId));
    for (const s of others) {
      try {
        await fetchApi(`/api/studio/sessions/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      } catch {
        // 忽略单个删除失败，继续清理其余
      }
    }
    await load();
  }

  async function clearCurrentSession() {
    if (!activeSessionId) return;
    setConfirmDialog({
      message: "清空当前会话的所有消息？此操作不可撤销。",
      onConfirm: () => doClearCurrent(),
    });
  }

  async function doClearCurrent() {
    const sid = activeSessionId;
    setMessages([]);
    setCheckpoints([]);
    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(sid)}/messages`, { method: "DELETE" });
    } catch {
      // 忽略删除失败
    }
  }

  async function rollbackTo(checkpointId: string, label: string) {
    if (!checkpointId) return;
    setConfirmDialog({
      message: `回滚到「${label || "历史状态"}」？\n这之后的文件改动会被撤销，对话记录保留。`,
      onConfirm: () => doRollback(checkpointId),
    });
  }

  async function doRollback(checkpointId: string) {
    setRollbackMenuOpen(false);
    const baseUrl = agentBaseUrl();
    const token = agentToken || readStoredAgentToken();
    if (!baseUrl || !token) {
      setError("无法回滚：本机 Agent 未连接");
      return;
    }
    setAgentActionMessage("正在回滚…");
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(agentWebSocketUrl(baseUrl, token));
        const timer = window.setTimeout(() => { try { ws.close(); } catch {} reject(new Error("回滚超时")); }, 10000);
        ws.onopen = () => ws.send(JSON.stringify({ type: "rollback", checkpointId }));
        ws.onmessage = (event) => {
          let body: Record<string, unknown>;
          try { body = JSON.parse(String(event.data || "{}")) as Record<string, unknown>; } catch { return; }
          if (body.type === "rolled") { window.clearTimeout(timer); try { ws.close(); } catch {} resolve(); }
          else if (body.type === "error") { window.clearTimeout(timer); try { ws.close(); } catch {} reject(new Error(String(body.error || "回滚失败"))); }
        };
        ws.onerror = () => { window.clearTimeout(timer); reject(new Error("本机 Agent 连接失败")); };
      });
      setAgentActionMessage("已回滚到历史状态");
      setMessages((current) => [...current, {
        id: `sys_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        role: "assistant" as const,
        content: "✅ 已回滚到该时间点的文件状态（对话记录保留）",
        createdAt: Math.floor(Date.now() / 1000),
        kind: "status" as const,
        statusText: "已回滚",
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "回滚失败");
      setAgentActionMessage("");
    }
  }

  async function applyQuickAction(value: string) {
    setQuickMenuOpen(false);
    if (agentRunning || savingStudioItem || !value.trim()) return;
    await sendMessage(value);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!savingStudioItem && !agentRunning && (prompt.trim() || attachments.length > 0)) {
      void sendMessage();
    }
  }

  async function copyText(label: string, value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        size: file.size,
        type: file.type || "file",
      })),
    ]);
    event.target.value = "";
    setInspectorTab("files");
  }

  function toggleVoiceInput() {
    if (voiceState === "listening") {
      recognitionRef.current?.stop();
      setVoiceState("idle");
      return;
    }

    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceState("unsupported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join("")
        .trim();
      if (transcript) setPrompt((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onend = () => setVoiceState("idle");
    recognition.onerror = () => setVoiceState("idle");
    recognitionRef.current = recognition;
    setVoiceState("listening");
    recognition.start();
  }

  if (error && !data) {
    return (
      <main className={styles.page}>
        <div className={styles.centerState}>
          <CircleAlert size={28} />
          <h1>Studio 加载失败</h1>
          <p>{error}</p>
          <button type="button" onClick={load}>重试</button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.centerState}>
          <Sparkles size={30} />
          <h1>正在启动 Studio</h1>
          <p>加载会话、模型和本机 Agent 状态。</p>
        </div>
      </main>
    );
  }

  const agentOnline = agentStatus.state === "online";
  const agentReachable = agentStatus.state === "online" || agentStatus.state === "unpaired";
  const agentConfigured = agentOnline && Boolean(agentStatus.claude?.configured);
  const agentPaired = Boolean(agentToken || readStoredAgentToken());
  const setupStep = agentConfigured ? 3 : agentOnline && agentPaired ? 2 : 1;
  const quotaClass = quotaStatusClass(data.quota.status);

  const commandList: Array<{ id: string; label: string; hint?: string; run: () => void }> = [];
  EXECUTION_MODES.forEach((m) => commandList.push({ id: `mode-${m.id}`, label: `切换模式 · ${m.label}`, hint: m.title, run: () => updateExecutionMode(m.id) }));
  data.modelGroups.forEach((g) => g.models.forEach((m) => commandList.push({ id: `model-${m.claudeCodeId}`, label: `切换模型 · ${m.displayName}`, hint: g.label, run: () => setSelectedModel(m.claudeCodeId) })));
  QUICK_ACTIONS.forEach((q) => commandList.push({ id: `quick-${q.label}`, label: `指令 · ${q.label}`, hint: q.hint, run: () => applyQuickAction(q.value) }));
  commandList.push({ id: "new", label: "新建会话", run: () => createSession() });
  commandList.push({ id: "clear", label: "清理其他会话", run: () => clearOtherSessions() });
  checkpoints.forEach((cp) => commandList.push({ id: `rb-${cp.id}`, label: `回滚 · ${cp.label || "历史状态"}`, hint: formatRelativeTime(cp.createdAt), run: () => rollbackTo(cp.id, cp.label) }));
  const commandQueryLower = commandQuery.trim().toLowerCase();
  const commandFiltered = commandQueryLower
    ? commandList.filter((c) => c.label.toLowerCase().includes(commandQueryLower) || (c.hint?.toLowerCase().includes(commandQueryLower)))
    : commandList;
  function handleCommandKey(e: KeyboardEvent) {
    if (e.key === "Escape") { setCommandOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCommandIndex((i) => Math.min(i + 1, commandFiltered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setCommandIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); const cmd = commandFiltered[commandIndex]; if (cmd) { cmd.run(); setCommandOpen(false); } }
  }

  return (
    <main className={`${styles.page} ${theme === "light" ? styles.themeLight : ""}`}>
      <section className={styles.shell} aria-label="Sparkloom Studio">
        <nav className={styles.activityRail} aria-label="工作区工具栏">
          <Link href="/dashboard" className={styles.railBrand} title={BRAND_NAME} aria-label={BRAND_NAME}>
            <Image src="/logo.png" alt="" width={26} height={26} />
          </Link>
          <button type="button" className={styles.railActive} title="会话" aria-label="会话">
            <MessageSquare size={18} />
          </button>
          <button type="button" title="Skills" aria-label="Skills" onClick={() => setInspectorTab("skills")}>
            <Boxes size={18} />
          </button>
          <Link href="/download" title="安装 Agent" aria-label="安装 Agent">
            <Download size={18} />
          </Link>
          <button type="button" title="切换浅色/深色主题" aria-label="切换主题" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </nav>

        <aside className={styles.sidebar}>
          <div className={styles.brandRow}>
            <div className={styles.workspaceLabel}>
              <span>Workspace</span>
              <strong>{BRAND_NAME}</strong>
            </div>
            <Link href="/download" className={styles.iconButton} title="下载安装 Agent" aria-label="下载安装 Agent">
              <Download size={17} />
            </Link>
          </div>

          <button className={styles.newTaskButton} type="button" onClick={createSession} disabled={savingStudioItem}>
            <Plus size={16} />
            New task
          </button>

          <label className={styles.searchBox}>
            <Search size={15} />
            <input
              type="search"
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
            />
          </label>

          <div className={styles.sidebarSection}>
            <span className={styles.sectionTitle}>Sessions</span>
            <div className={styles.sessionList}>
              {sessions.length === 0 ? (
                <button className={styles.emptySession} type="button" onClick={createSession}>
                  <MessageSquare size={16} />
                  创建第一个任务
                </button>
              ) : filteredSessions.length === 0 ? (
                <button className={styles.emptySession} type="button" onClick={() => setSessionSearch("")}>
                  <Search size={16} />
                  没有匹配会话
                </button>
              ) : (
                filteredSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`${styles.sessionItem} ${session.id === activeSessionId ? styles.sessionActive : ""}`}
                  >
                    <button type="button" className={styles.sessionSelect} onClick={() => setActiveSessionId(session.id)}>
                      <span className={styles.sessionTitle}>
                        {session.title}
                        {session.id === runningSessionId && <i className={styles.sessionRunning} title="后台运行中" />}
                      </span>
                      <em>{formatRelativeTime(session.updatedAt)}</em>
                    </button>
                    <button
                      type="button"
                      className={styles.sessionDelete}
                      aria-label={`删除会话 ${session.title}`}
                      title="删除会话"
                      onClick={() => deleteSession(session.id, session.title)}
                      disabled={savingStudioItem}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.sidebarFooter}>
            <div className={styles.miniStat}>
              <Gauge size={15} />
              <span>{formatCurrency(data.quota.remaining)} 剩余</span>
            </div>
            <div className={`${styles.agentDot} ${agentReachable ? styles.agentOnline : styles.agentOffline}`} />
            <span>{agentStatus.state === "online" ? `Agent ${agentStatus.version}` : agentStatus.state === "unpaired" ? "需配对" : "未连接"}</span>
          </div>
        </aside>

        <section className={styles.workspace}>
          <header className={styles.chromeBar}>
            <div className={styles.contextTitle}>
              <strong>{activeSession?.title || "Untitled task"}</strong>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className={styles.modelSelect}
                title="切换模型"
              >
                {data.modelGroups.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.models.map((model) => (
                      <option key={model.claudeCodeId} value={model.claudeCodeId}>
                        {model.displayName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className={styles.chromeActions}>
              <div className={styles.modeSwitch} role="radiogroup" aria-label="Agent execution mode">
                {EXECUTION_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    title={mode.description}
                    aria-checked={executionMode === mode.id}
                    className={executionMode === mode.id ? styles.modeActive : ""}
                    onClick={() => updateExecutionMode(mode.id)}
                    disabled={agentRunning}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <div className={styles.quickMenuWrap}>
                <button type="button" className={styles.toolbarButton} onClick={() => setRollbackMenuOpen((v) => !v)} disabled={checkpoints.length === 0} title="回滚到历史状态">
                  <RotateCcw size={15} />
                  回滚
                </button>
                {rollbackMenuOpen && checkpoints.length > 0 && (
                  <div className={styles.rollbackMenu} data-popover>
                    {checkpoints.slice().reverse().map((cp) => (
                      <button key={cp.id} type="button" onClick={() => rollbackTo(cp.id, cp.label)}>
                        <strong>{cp.label || "历史状态"}</strong>
                        <span>{formatRelativeTime(cp.createdAt)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className={styles.toolbarButton} onClick={clearCurrentSession} disabled={!activeSessionId} title="清空当前对话">
                <Eraser size={15} />
                清空
              </button>
            </div>
          </header>

          {error && (
            <div className={styles.inlineError} role="alert">
              <CircleAlert size={16} />
              {error}
              {lastFailedContent.current && !agentRunning && !savingStudioItem && (
                <button type="button" className={styles.retryButton} onClick={() => { const c = lastFailedContent.current; lastFailedContent.current = ""; setError(""); void sendMessage(c); }}>重试</button>
              )}
            </div>
          )}

          {(!agentConfigured || !agentPaired) && (
            <div className={styles.setupGuide} aria-label="Sparkloom 本机连接步骤">
              <div className={setupStep >= 1 ? styles.setupDone : ""}>
                <span>1</span>
                <strong>下载 Sparkloom</strong>
              </div>
              <div className={setupStep >= 2 ? styles.setupDone : ""}>
                <span>2</span>
                <strong>打开 Sparkloom</strong>
              </div>
              <div className={setupStep >= 3 ? styles.setupDone : ""}>
                <span>3</span>
                <strong>{agentConfigured ? "已连接" : "写入配置"}</strong>
              </div>
              <Link href="/download" className={styles.setupButton}>
                {agentOnline ? "重新下载" : "下载"}
              </Link>
              <button type="button" className={styles.setupButton} onClick={checkAgent}>
                重新连接
              </button>
            </div>
          )}

          <div className={styles.conversation}>
            <div
              className={styles.messageStream}
              ref={streamRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {messages.length === 0 ? (
                <div className={styles.emptyChat}>
                  <Bot size={30} />
                  <h1>开始一个开发任务</h1>
                  <p>描述要审查、修改、发布或排查的项目。Studio 会保存上下文、文件和本地 Agent 状态。</p>
                  <div className={styles.promptChips}>
                    <button type="button" onClick={() => sendMessage("帮我审查当前项目的上线风险，并列出必须修复项。")}>上线审查</button>
                    <button type="button" onClick={() => sendMessage("检查前端页面的布局、交互和响应式问题。")}>UI 检查</button>
                    <button type="button" onClick={() => sendMessage("根据当前日志定位 bug，并给出修复方案。")}>Bug 修复</button>
                  </div>
                </div>
              ) : (
                messages.map((message) => {
                  if (message.kind === "status") {
                    return (
                      <div key={message.id} className={styles.statusLine}>
                        <Loader2 size={14} className={styles.spin} />
                        <span>{message.statusText || message.content}</span>
                      </div>
                    );
                  }
                  if (message.kind === "result" && message.usage) {
                    const u = message.usage;
                    return (
                      <div key={message.id} className={styles.resultLine}>
                        <CheckCircle2 size={13} />
                        <span>完成 · 输入 {(u.inputTokens ?? 0).toLocaleString()} · 输出 {(u.outputTokens ?? 0).toLocaleString()}</span>
                        {message.changedFiles ? <span>· 改动 {message.changedFiles} 个文件</span> : null}
                        <strong>¥{(u.costUsd ?? 0).toFixed(4)}</strong>
                        {message.durationMs ? <em>{(message.durationMs / 1000).toFixed(1)}s{message.numTurns ? ` · ${message.numTurns} 轮` : ""}</em> : null}
                      </div>
                    );
                  }
                  if (message.kind === "tool") {
                    const isPending = Boolean(message.approvalId) && message.toolState === "running";
                    const expanded = isPending || expandedTools.has(message.id);
                    const stateLabel = message.toolState === "done" ? "已完成" : message.toolState === "error" ? "失败" : isPending ? "待确认" : "进行中";
                    const isEditLike = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(message.toolName || ""));
                    const editInfo = isEditLike ? parseEditInput(message.toolInput) : null;
                    const summarySrc = editInfo?.filePath || message.toolInput || message.result || "";
                    const summary = summarySrc.split("\n")[0].replace(/^\s+/, "").slice(0, 70);
                    return (
                      <div key={message.id} className={`${styles.toolCard} ${isPending ? styles.toolPending : ""} ${message.risk ? styles[`risk_${message.risk}` as "risk_safe" | "risk_warn" | "risk_danger"] : ""}`}>
                        <div className={styles.toolHead} onClick={() => { if (!isPending) toggleToolExpand(message.id); }} style={{ cursor: isPending ? "default" : "pointer" }}>
                          <span className={styles.toolIcon}><Wrench size={13} /></span>
                          <strong>{message.toolName}</strong>
                          {!expanded && summary && <span className={styles.toolSummary}>{summary}</span>}
                          <em>{stateLabel}{!isPending && <span className={styles.toolChevron}>{expanded ? "▾" : "▸"}</span>}</em>
                        </div>
                        {expanded && (
                          <>
                            {message.humanHint && <p className={styles.toolHint}>{message.humanHint}</p>}
                            {editInfo ? (
                              <DiffBlock filePath={editInfo.filePath} oldText={editInfo.oldText} newText={editInfo.newText} />
                            ) : (
                              message.toolInput && <pre className={styles.toolInput}>{message.toolInput}</pre>
                            )}
                            {message.result && (
                              <pre className={`${styles.toolInput} ${message.isError ? styles.toolResultErr : styles.toolResultOk}`}>{message.result}</pre>
                            )}
                            {isPending && (
                              <div className={styles.approvalActions}>
                                <button type="button" className={styles.approvalDeny} disabled={respondingApprovalId === message.approvalId} onClick={() => respondApproval(message.approvalId!, "deny")}>拒绝 <kbd>N</kbd></button>
                                <button type="button" className={`${styles.approvalAllow} ${message.risk === "danger" ? styles.approvalDangerBg : ""}`} disabled={respondingApprovalId === message.approvalId} onClick={() => respondApproval(message.approvalId!, "allow")}>{respondingApprovalId === message.approvalId ? <Loader2 size={13} className={styles.spin} /> : null}批准 <kbd>Y</kbd></button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }
                  const isUser = message.role === "user";
                  return (
                    <article key={message.id} className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
                      <div className={styles.messageAvatar}>{isUser ? data.user.name.slice(0, 1) : <Bot size={16} />}</div>
                      <div className={styles.messageBody}>
                        <header>
                          <strong>{isUser ? data.user.name : "Sparkloom"}</strong>
                          <span>{formatRelativeTime(message.createdAt)}</span>
                        </header>
                        {isUser ? (
                          <div className={styles.userContent}>
                            <p>{message.content}</p>
                            {!agentRunning && (
                              <button type="button" className={styles.editButton} onClick={() => startEditMessage(message)} title="编辑并从这里重新生成">
                                <Pencil size={12} /> 编辑
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className={styles.markdown}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}>{message.content || ""}</ReactMarkdown>
                            {message.isStreaming && <span className={styles.streamCursor} />}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className={styles.projectPathBar}>
              <FolderInput size={15} />
              <button
                type="button"
                className={styles.projectPickerBtn}
                onClick={() => setProjectPickerOpen((v) => !v)}
                title="选择项目目录"
              >
                {projectPath.trim() || "选择项目目录…"}
              </button>
              {projectPickerOpen && (
                <div className={styles.atMenu} data-popover style={{ width: 280 }}>
                  <input
                    autoFocus
                    className={styles.commandInput}
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { pickProject(projectPath); } }}
                    placeholder="输入或粘贴路径，或选最近项目"
                  />
                  {recentProjects.length > 0 && (
                    <>
                      <div className={styles.commandEmpty} style={{ padding: "6px 10px", textAlign: "left" }}>最近项目</div>
                      {recentProjects.map((p) => (
                        <button key={p} type="button" className={styles.atItem} onClick={() => pickProject(p)}>
                          <span>📁</span>
                          <span className={styles.atName}>{p}</span>
                        </button>
                      ))}
                    </>
                  )}
                  <button type="button" className={`${styles.primaryAction} ${styles.atItem}`} onClick={() => pickProject(projectPath)} style={{ marginTop: 4 }}>
                    确认使用当前路径
                  </button>
                </div>
              )}
            </div>

            {attachments.length > 0 && (
              <div className={styles.attachmentTray}>
                {attachments.map((file) => (
                  <span key={file.id}>
                    <FileText size={14} />
                    {file.name}
                    <button
                      type="button"
                      aria-label={`移除 ${file.name}`}
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {agentRunning && agentActionMessage && (
              <div className={styles.composerStatus}><Loader2 size={13} className={styles.spin} /> {agentActionMessage}</div>
            )}
            <div className={styles.composer}>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className={styles.hiddenInput} />
              <button type="button" className={styles.roundButton} onClick={() => fileInputRef.current?.click()} title="添加文件" aria-label="添加文件">
                <Paperclip size={18} />
              </button>
              <div className={styles.quickMenuWrap}>
                <button type="button" className={styles.roundButton} onClick={openAtMenu} title="引用项目文件" aria-label="引用项目文件" aria-expanded={atMenuOpen}>
                  <AtSign size={18} />
                </button>
                {atMenuOpen && (
                  <div className={styles.atMenu} data-popover>
                    {atLoading && <div className={styles.commandEmpty}>加载中…</div>}
                    {!atLoading && atFiles.length === 0 && <div className={styles.commandEmpty}>{projectPath.trim() ? "目录为空或不可读" : "请先填写项目目录"}</div>}
                    {atFiles.map((f) => (
                      <button key={f.name} type="button" className={styles.atItem} onClick={() => insertFileRef(f.name)}>
                        <span>{f.isDir ? "📁" : "📄"}</span>
                        <span className={styles.atName}>{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.quickMenuWrap}>
                <button
                  type="button"
                  className={styles.roundButton}
                  onClick={() => setQuickMenuOpen((current) => !current)}
                  title="常用命令"
                  aria-label="常用命令"
                  aria-expanded={quickMenuOpen}
                >
                  <Command size={17} />
                  <ChevronDown size={11} />
                </button>
                {quickMenuOpen && (
                  <div
                    className={styles.quickMenu}
                    data-popover
                    tabIndex={-1}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setQuickMenuOpen(false); return; }
                      if (e.key === "ArrowDown") { e.preventDefault(); setActiveQuickIndex((i) => Math.min(i + 1, QUICK_ACTIONS.length - 1)); return; }
                      if (e.key === "ArrowUp") { e.preventDefault(); setActiveQuickIndex((i) => Math.max(i - 1, 0)); return; }
                      if (e.key === "Enter") { e.preventDefault(); const a = QUICK_ACTIONS[activeQuickIndex]; if (a) applyQuickAction(a.value); }
                    }}
                  >
                    {QUICK_ACTIONS.map((action, i) => (
                      <button key={action.label} type="button" className={i === activeQuickIndex ? styles.commandActive : ""} onClick={() => applyQuickAction(action.value)}>
                        <strong>{action.label}</strong>
                        <span>{action.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="输入任务、粘贴日志、描述你希望 Studio 做什么..."
              />
              <button
                type="button"
                className={`${styles.roundButton} ${voiceState === "listening" ? styles.voiceActive : ""}`}
                onClick={toggleVoiceInput}
                title={voiceState === "unsupported" ? "当前浏览器不支持语音输入" : "语音输入"}
                aria-label="语音输入"
              >
                <Mic size={18} />
              </button>
              <button
                type="button"
                className={styles.sendButton}
                onClick={agentRunning ? cancelAgentRun : () => sendMessage()}
                disabled={!agentRunning && (savingStudioItem || (!prompt.trim() && attachments.length === 0))}
                aria-label={agentRunning ? "取消 Agent 任务" : "发送任务"}
              >
                {agentRunning ? <X size={17} /> : <Play size={17} />}
              </button>
            </div>
            <div className={styles.composerHint}>Enter 发送 · Shift+Enter 换行 · Esc 中断 · Y/N 审批 · ⌘K 命令面板</div>
            {voiceState === "unsupported" && <div className={styles.composerHint}>当前浏览器不支持 Web Speech API，可以继续使用键盘输入。</div>}
          </div>

        </section>

        {commandOpen && (
          <div className={styles.commandOverlay} onClick={() => setCommandOpen(false)}>
            <div className={styles.commandPalette} onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                className={styles.commandInput}
                value={commandQuery}
                onChange={(e) => { setCommandQuery(e.target.value); setCommandIndex(0); }}
                onKeyDown={handleCommandKey}
                placeholder="搜索命令、模型、模式…（↑↓ 选择，回车执行，Esc 关闭）"
              />
              <div className={styles.commandList}>
                {commandFiltered.map((cmd, i) => (
                  <button key={cmd.id} type="button" className={i === commandIndex ? styles.commandActive : styles.commandItem} onClick={() => { cmd.run(); setCommandOpen(false); }}>
                    <span>{cmd.label}</span>
                    {cmd.hint && <em>{cmd.hint}</em>}
                  </button>
                ))}
                {commandFiltered.length === 0 && <div className={styles.commandEmpty}>无匹配命令</div>}
              </div>
            </div>
          </div>
        )}

      </section>

      {confirmDialog && (
        <div className={styles.commandOverlay} onClick={() => setConfirmDialog(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()} data-popover>
            <CircleAlert size={28} />
            <p>{confirmDialog.message}</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.approvalDeny} onClick={() => setConfirmDialog(null)}>取消</button>
              <button type="button" className={styles.approvalAllow} onClick={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); void fn(); }}>确认</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof SlidersHorizontal; title: string }) {
  return (
    <div className={styles.panelTitle}>
      <Icon size={17} />
      <h2>{title}</h2>
    </div>
  );
}

function PermissionRow({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className={styles.permissionRow}>
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConfigBlock({
  title,
  value,
  copied,
  onCopy,
}: {
  title: string;
  value: string;
  copied: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className={styles.configBlock}>
      <div className={styles.configHead}>
        <span>{title}</span>
        <button type="button" onClick={() => onCopy(title, value)} aria-label={`复制${title}`}>
          {copied === title ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function parseEditInput(inputStr?: string): { filePath?: string; oldText?: string; newText?: string } | null {
  if (!inputStr) return null;
  try {
    const obj = JSON.parse(inputStr) as Record<string, unknown>;
    return {
      filePath: typeof obj.file_path === "string" ? obj.file_path : undefined,
      oldText: typeof obj.old_string === "string" ? obj.old_string : "",
      newText: typeof obj.new_string === "string" ? obj.new_string : typeof obj.content === "string" ? obj.content : "",
    };
  } catch {
    return null;
  }
}

function DiffBlock({ filePath, oldText, newText }: { filePath?: string; oldText?: string; newText?: string }) {
  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");
  return (
    <div className={styles.diffBlock}>
      {filePath && (
        <div className={styles.diffFile}><FilePen size={12} /> {filePath}</div>
      )}
      <pre className={styles.diffCode}>
        {oldLines.map((line, i) => (
          <div key={`o${i}`} className={styles.diffDelLine}><span className={styles.diffSign}>-</span>{line || " "}</div>
        ))}
        {newLines.map((line, i) => (
          <div key={`n${i}`} className={styles.diffAddLine}><span className={styles.diffSign}>+</span>{line || " "}</div>
        ))}
      </pre>
    </div>
  );
}

function CodeBlock(props: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = ref.current?.textContent || "";
    if (text) {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className={styles.codeBlock}>
      <button type="button" className={styles.codeCopy} onClick={copy} aria-label="复制代码">
        {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
      </button>
      <pre ref={ref}>{props.children}</pre>
    </div>
  );
}
