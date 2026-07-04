"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, KeyboardEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  Boxes,
  ChevronDown,
  CheckCircle2,
  CircleAlert,
  Command,
  Copy,
  Check,
  Cpu,
  Download,
  FileText,
  FolderOpen,
  Gauge,
  GitBranch,
  Menu,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  KeyRound,
  Laptop,
  Lock,
  MessageSquare,
  Mic,
  Paperclip,
  Play,
  Plus,
  Square,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
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
  Code,
  ListTodo,
  Plug,
  Eye,
  DollarSign,
  BookOpen,
  LayoutTemplate,
  Pin,
  Library,
  Bell,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BRAND_NAME } from "@/lib/brand";
import { ApiError, fetchApi } from "@/lib/fetcher";
import {
  maybeNotifyTaskComplete,
  readNotifySettings,
  registerNotifyClickHandler,
  requestNotifyPermission,
  setNotifyEnabled,
  isNotifySupported,
  type NotifySettings,
} from "@/lib/studio-notify";
import { resolveLang, tokenizeCode, tokenizeLine, type ThemedToken } from "@/lib/shiki";
import TodoListPanel from "./TodoListPanel";
import ToolResultOutput from "./ToolResultOutput";
import SkillsPanel from "./SkillsPanel";
import McpPanel from "./McpPanel";
import CostPanel, { type UsageRecord } from "./CostPanel";
import MemoryPanel from "./MemoryPanel";
import HooksPanel from "./HooksPanel";
import TemplatesPanel from "./TemplatesPanel";
import AgentsPanel from "./AgentsPanel";
import PromptLibrary from "./PromptLibrary";
import ImportSessionButton, { type ImportedSession } from "./ImportSessionButton";
import OnboardingModal, { isOnboarded, markOnboarded, getOnboardedDefaultModel } from "./OnboardingModal";
import styles from "./studio.module.css";

type QuotaStatus = "normal" | "warning" | "critical" | "exceeded";
type InspectorTab = "model" | "permissions" | "files" | "skills" | "mcp" | "cost" | "memory" | "hooks" | "templates" | "agents";
type ExecutionMode = "default" | "plan" | "auto" | "yolo";

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
  projectPath?: string | null;
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
  resultFull?: string;
  resultTruncatedCap?: boolean;
  isError?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number; cacheCreation?: number; cacheRead?: number };
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
  file?: File;
  objectUrl?: string;
  base64?: string;
  mediaType?: string;
}

// Claude Code TodoWrite 招牌 UX：边干边维护的 todo list
interface StudioTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
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
  { id: "templates", label: "模板", icon: LayoutTemplate },
  { id: "skills", label: "技能", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "cost", label: "成本", icon: DollarSign },
  { id: "memory", label: "记忆", icon: BookOpen },
  { id: "hooks", label: "Hooks", icon: Zap },
];

// Claude 上下文窗口基准值（用于占用条估算，非精确数值）
const CONTEXT_WINDOW_TOKENS = 200_000;
const REMARK_PLUGINS = [remarkGfm];

const EXECUTION_MODES: Array<{ id: ExecutionMode; label: string; title: string; description: string; danger?: boolean }> = [
  { id: "default", label: "Ask", title: "每次确认", description: "本地 SDK 遇到工具动作时按默认权限流程确认。" },
  { id: "plan", label: "Plan", title: "计划模式", description: "只做分析和计划，不直接改文件或执行高风险动作。" },
  { id: "auto", label: "Auto", title: "自动执行", description: "由本机 Agent 通过 Claude Agent SDK 自动推进任务。" },
  // 任务 4：yolo 全自动无确认（permissionMode=bypassPermissions），UI 红色危险提示
  { id: "yolo", label: "Yolo", title: "全自动无确认", description: "全部工具调用自动放行，不再弹审批。仅在你完全信任任务和目录时使用。", danger: true },
];

const QUICK_ACTIONS = [
  { label: "Compact", value: "/compact", hint: "压缩当前上下文" },
  { label: "Clear", value: "/clear", hint: "清空当前上下文" },
  { label: "Init", value: "/init", hint: "初始化项目说明" },
  { label: "Status", value: "检查当前项目状态，并列出下一步建议。", hint: "项目状态" },
  { label: "Review", value: "审查当前项目的风险、权限、密钥和上线阻断项。", hint: "代码审查" },
  { label: "Fix", value: "根据当前错误定位原因，直接修复并验证。", hint: "修复问题" },
];

// 任务 4 斜杠命令补全：内置 Claude Code 风格的命令清单
// kind 说明：
//   send → 走 sendMessage（清空 + 发送）
//   tab  → 切换 Inspector 标签
//   notice → 仅显示提示（agent 端暂无对应能力）
type SlashCommandKind = "send" | "tab" | "notice";
interface SlashCommand {
  cmd: string;
  desc: string;
  kind: SlashCommandKind;
  tab?: InspectorTab;
  notice?: string;
}
const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/clear", desc: "清空当前上下文（下条消息开新会话）", kind: "send" },
  { cmd: "/compact", desc: "压缩上下文（SDK 自动管理）", kind: "send" },
  { cmd: "/init", desc: "初始化项目说明（生成 CLAUDE.md）", kind: "send" },
  { cmd: "/cost", desc: "查看当前会话累计花费", kind: "notice", notice: "在每轮回复底部会自动显示花费，无需单独查询。" },
  { cmd: "/config", desc: "打开 Inspector「执行」标签", kind: "tab", tab: "permissions" },
  { cmd: "/mcp", desc: "打开 Inspector「MCP」标签", kind: "tab", tab: "mcp" },
  { cmd: "/templates", desc: "打开 Inspector「模板」标签", kind: "tab", tab: "templates" },
  { cmd: "/agents", desc: "管理子 agent（.claude/agents/*.md）", kind: "tab", tab: "agents" },
  { cmd: "/prompt", desc: "打开提示库（常用 prompt 模板）", kind: "notice", notice: "提示库已打开，点击任意条目即可插入到输入框。" },
  { cmd: "/memory", desc: "查看记忆", kind: "tab", tab: "memory" },
  { cmd: "/model", desc: "切换模型（请用 ⌘K 命令面板）", kind: "notice", notice: "按 ⌘K / Ctrl+K 打开命令面板切换模型。" },
  { cmd: "/help", desc: "查看可用斜杠命令", kind: "notice", notice: "输入 / 触发补全：/clear /compact /init /cost /config /mcp 等。" },
];

const AGENT_TOKEN_STORAGE_KEY = "sparkloom.agentToken";
const PROJECT_PATH_STORAGE_KEY = "sparkloom.projectPath";
const USAGE_STORAGE_KEY = "sparkloom.usage";
const ONBOARDED_KEY = "sparkloom.onboarded";
const ONBOARDED_DEFAULT_MODEL_KEY = "sparkloom.onboardDefaultModel";
const DEFAULT_AGENT_MAX_TURNS = 40;

// 任务 1 成本统计：把每条 usage 记录追加到 localStorage（同步写一次，避免在 setState callback 内产生副作用）
// 上限 2000 条，超出裁掉最早的（避免无限增长）
function appendUsageRecord(rec: UsageRecord): void {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    const arr: UsageRecord[] = raw ? JSON.parse(raw) as UsageRecord[] : [];
    arr.push(rec);
    const trimmed = arr.length > 2000 ? arr.slice(arr.length - 2000) : arr;
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // 忽略：隐私模式或 quota 异常时也不影响主流程
  }
}

function readUsageRecords(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as UsageRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function clearUsageRecords(): void {
  try {
    localStorage.removeItem(USAGE_STORAGE_KEY);
  } catch { /* ignore */ }
}
// P2 长会话虚拟滚动：初始只渲染最近 N 条，向上滚触顶 IntersectionObserver 再 prepend M 条
const MESSAGE_RENDER_CAP = 200;
const MESSAGE_RENDER_GROW = 100;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sparkloom.studioSidebarCollapsed";

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
  // 任务 4：yolo 全自动无确认（危险），单独校验避免回退到 default
  if (value === "yolo") return "yolo";
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
      "Agent 触发了任务步骤上限，未完成全部工作。",
      "已上调新一轮的默认上限。可以缩小指令范围，或在 Plan 模式下先规划再执行。",
      detail,
    ].filter(Boolean).join("\n");
  }
  if (candidates.length > 0) return detail;
  return responseStatus > 0
    ? `Agent 返回 HTTP ${responseStatus}，但未给出成功结果。`
    : "Agent 未返回成功结果。";
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
  // P2-1/P2-5 内联成功/提示消息（区别于 error 的红色），3.5s 自动清除
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 3500);
  }, []);
  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);
  // P2-5 消息级撤回 state：定义早，函数定义挪到 claudeSessionRef 之后（避免 TDZ）
  const [lastSentForUndo, setLastSentForUndo] = useState<{ sessionId: string; userMsgId: string; userContent: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);
  const [selectedModel, setSelectedModel] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ state: "checking" });
  const [newKey, setNewKey] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [copied, setCopied] = useState("");
  const [sessions, setSessions] = useState<StudioSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  // claude session 映射：studioSessionId → claude.exe session_id（SDK resume 续上下文）。
  // 存 localStorage（本机同浏览器刷新有效；claude session 与本机 agent 绑定，跨设备无需同步）。
  const claudeSessionRef = useRef<Map<string, string>>(new Map<string, string>(
    (() => { try { return JSON.parse(localStorage.getItem("sparkloom.claudeSessionMap") || "[]") as [string, string][]; } catch { return [] as [string, string][]; } })()
  ));
  const persistClaudeSessionMap = useCallback(() => {
    try { localStorage.setItem("sparkloom.claudeSessionMap", JSON.stringify([...claudeSessionRef.current.entries()])); } catch {}
  }, []);
  // P2-5 消息级撤回：放在 claudeSessionRef / persistClaudeSessionMap 之后避免 TDZ
  const undoLastSend = useCallback(async () => {
    const target = lastSentForUndo;
    if (!target) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastSentForUndo(null);
    try {
      // DELETE 最后一条 user 消息及其后所有 assistant（走现有 from=userId 接口）
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(target.sessionId)}/messages?from=${encodeURIComponent(target.userMsgId)}`, { method: "DELETE" });
      // 同步清 claude session 映射（避免下次 resume 还看到被撤的轮次）
      claudeSessionRef.current.delete(target.sessionId);
      persistClaudeSessionMap();
      // 更新 UI：把该 user 消息及其后所有消息从 messages state 移除
      setMessages((current) => {
        const idx = current.findIndex((m) => m.id === target.userMsgId);
        return idx === -1 ? current : current.slice(0, idx);
      });
      // 把被撤回的 content 回填输入框，方便用户修改后重发
      setPrompt(target.userContent);
      showNotice("已撤回（仅清理本工具记录，AI 端上下文已重置）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回失败");
    }
  }, [lastSentForUndo, showNotice, persistClaudeSessionMap]);
  const activeSessionIdRef = useRef("");
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  const agentRunningRef = useRef(false);
  const agentCancelledRef = useRef(false); // 用户主动取消标记，让 onclose 跳过 finalize 失败消息
  // P1-c cancel 保留已生成输出：cancelAgentRun 关 socket 前先把 streamText 落库
  const agentStreamSnapshotRef = useRef<{ text: string; sessionId: string; streamMessageId: string } | null>(null);
  const saveAssistantMessageRef = useRef<(sessionId: string, content: string, replaceLocalId?: string) => Promise<unknown>>(() => Promise.resolve());
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
  const [autoAcceptSession, setAutoAcceptSession] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("model");
  // 任务 1：usage 版本号触发 CostPanel 重新读 localStorage
  const [usageVersion, setUsageVersion] = useState(0);
  const usageRecords = useMemo<UsageRecord[]>(() => {
    // 依赖 usageVersion 才能感知写入；不需要把 records 自身放 state
    void usageVersion;
    return readUsageRecords();
  }, [usageVersion]);
  // 任务 5 onboarding：首次启动显示引导
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("default");
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [savingStudioItem, setSavingStudioItem] = useState(false);
  const [agentActionBusy, setAgentActionBusy] = useState("");
  const [agentActionMessage, setAgentActionMessage] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  // 任务 5 WebSocket 自动重连：connected=绿、reconnecting=黄（显示次数）、disconnected=红
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected" | "reconnecting">("disconnected");
  const [wsReconnectAttempt, setWsReconnectAttempt] = useState(0);
  const [agentToken, setAgentToken] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "unsupported">("idle");
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string; createdAt: number }>>([]);
  const [rollbackMenuOpen, setRollbackMenuOpen] = useState(false);
  // 任务 4 斜杠命令补全：当 prompt 末尾是 /word 时弹出菜单；Esc 关闭后抑制到 prompt 变化
  const [slashIndex, setSlashIndex] = useState(0);
  const slashSuppressedRef = useRef(false);
  const slashFiltered = useMemo(() => {
    if (slashSuppressedRef.current) return [] as SlashCommand[];
    // 末尾必须是 / 开头单词（前面是行首或空白）
    const m = prompt.match(/(^|\s)(\/[A-Za-z0-9_-]*)$/);
    if (!m) return [] as SlashCommand[];
    const query = m[2].toLowerCase();
    if (query === "/") {
      // 只有 / → 列出全部
      return SLASH_COMMANDS;
    }
    return SLASH_COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith(query) && c.cmd.toLowerCase() !== query);
  }, [prompt]);
  const slashMenuOpen = slashFiltered.length > 0;
  useEffect(() => { setSlashIndex(0); }, [slashMenuOpen]);
  useEffect(() => {
    // prompt 末尾不再是 /word 时解除抑制（让下次输入 / 还能弹出）
    if (!/(^|\s)\/[A-Za-z0-9_-]*$/.test(prompt)) slashSuppressedRef.current = false;
  }, [prompt]);
  // E-3 回滚前 diff 预览
  const [rollbackPreview, setRollbackPreview] = useState<{
    cpId: string;
    label: string;
    sensitiveHits: string[];
    loading: boolean;
    diff: {
      added: string[];
      modified: string[];
      deleted: string[];
      totalChanged: number;
      addedTotal: number;
      modifiedTotal: number;
      deletedTotal: number;
      snapshotedAt: number | null;
      cwd: string;
    } | null;
    error: string | null;
  } | null>(null);
  // P1-d 会话导出菜单
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  function triggerExport(format: "md" | "json") {
    if (!activeSessionIdRef.current) return;
    setExportMenuOpen(false);
    // 浏览器原生 download：直接打开 URL，Content-Disposition 会触发下载
    const url = `/api/studio/sessions/${encodeURIComponent(activeSessionIdRef.current)}/export?format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  // tool_result 完整输出展开：超 2000 字符的输出按需展开（虚拟滚动上限 500 行）
  const [expandedToolResults, setExpandedToolResults] = useState<Set<string>>(new Set());
  // TodoWrite 进度面板：Claude Code 边干边维护的 todo list
  const [todoList, setTodoList] = useState<StudioTodoItem[]>([]);
  const [todoPanelExpanded, setTodoPanelExpanded] = useState(false);
  // 任务 2 提示库开关：纯 web localStorage 持久化的 prompt 模板库
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  // 任务 5 会话置顶：localStorage 持久化置顶 sessionId 数组
  const [pinnedSessions, setPinnedSessions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("sparkloom.pinnedSessions") || "[]") as string[]; } catch { return []; }
  });
  const persistPinned = useCallback((next: string[]) => {
    try { localStorage.setItem("sparkloom.pinnedSessions", JSON.stringify(next)); } catch { /* ignore */ }
  }, []);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // P2-2 /context 调试视图：展示当前 Claude SDK 上下文来源 + session messages + token 估算
  const [contextView, setContextView] = useState<{
    loading: boolean;
    error: string | null;
    agent: {
      agentVersion: string;
      configDir: string;
      userDir: string;
      cwd: string | null;
      gateway: { configured: boolean; baseUrl: string | null; configFile: string; model: string | null };
      systemPromptSources: Array<{ kind: string; path: string; scope: string; exists: boolean; size: number }>;
      note: string;
    } | null;
    messages: Array<{ id: string; role: string; content: string; createdAt: number }>;
    totalTokens: number;
    contextWindow: number;
  } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  // P2-4 sidebar 折叠：桌面端 icon-only（58px），平板/窄屏抽屉模式
  // P2 持久化：mount 时读 localStorage，刷新后保持折叠状态（本机同浏览器）
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // P2 长会话虚拟滚动：messages 数组保留全部，但只渲染最近 visibleCount 条
  const [visibleCount, setVisibleCount] = useState(MESSAGE_RENDER_CAP);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const isPrependingRef = useRef(false);
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
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
  // 任务 3：当前任务开始信息（sessionId + startedAt），用于 result 到达时触发桌面通知
  const taskStartInfoRef = useRef<{ sessionId: string; startedAt: number } | null>(null);
  // 任务 3：通知设置（开关 + 支持情况 + 权限），驱动 Inspector UI
  const [notifySettings, setNotifySettings] = useState<NotifySettings>(() => readNotifySettings());
  // 任务 4：命令面板触发导入会话用的 input ref（ImportSessionButton 同步写入）
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      setError("");
      const next = await fetchApi<BootstrapData>("/api/studio/bootstrap");
      setData(next);
      const defaultModel = next.models.find((m) => /v4-pro|deepseek-v4-pro/i.test(m.claudeCodeId))?.claudeCodeId || next.models[0]?.claudeCodeId || "";
      setSelectedModel((current) => current || defaultModel);
      setSessions(next.sessions || []);
      // 取一次 total，供前端判断是否还有更多会话
      try {
        const head = await fetchApi<{ total: number }>("/api/studio/sessions?limit=1");
        setSessionsTotal(head.total ?? next.sessions?.length ?? 0);
      } catch {
        setSessionsTotal(next.sessions?.length ?? 0);
      }
      setActiveSessionId((current) => current || next.sessions?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Studio 加载失败");
    }
  }

  async function loadMoreSessions() {
    if (sessionsLoadingMore || searchMode) return;
    if (sessions.length >= sessionsTotal) return;
    setSessionsLoadingMore(true);
    try {
      const next = await fetchApi<{ sessions: StudioSession[]; total: number }>(
        `/api/studio/sessions?offset=${sessions.length}&limit=20`
      );
      setSessions((current) => {
        const seen = new Set(current.map((s) => s.id));
        const merged = [...current];
        for (const s of next.sessions || []) {
          if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
        }
        return merged;
      });
      setSessionsTotal(next.total ?? sessionsTotal);
    } catch {
      // 加载更多失败不阻塞，用户可稍后重试
    } finally {
      setSessionsLoadingMore(false);
    }
  }

  async function runSessionSearch(query: string) {
    const q = query.trim();
    if (!q) {
      setSearchMode(false);
      await load();
      return;
    }
    setSearchMode(true);
    try {
      const next = await fetchApi<{ sessions: StudioSession[]; query: string }>(
        `/api/studio/sessions/search?q=${encodeURIComponent(q)}&limit=30`
      );
      setSessions(next.sessions || []);
      setSessionsTotal(next.sessions?.length ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "会话搜索失败");
    }
  }

  async function renameSession(sessionId: string, title: string) {
    const trimmed = title.trim();
    setRenamingSessionId(sessionId);
    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed.slice(0, 80) || "New Studio Session" }),
      });
      setSessions((current) => current.map((s) => s.id === sessionId ? { ...s, title: trimmed || "New Studio Session", updatedAt: Math.floor(Date.now() / 1000) } : s));
      setEditingSessionId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重命名失败");
    } finally {
      setRenamingSessionId(null);
    }
  }

  async function updateSessionTitle(sessionId: string, title: string) {
    setRenamingSessionId(sessionId);
    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.slice(0, 80) || "New Studio Session" }),
      });
      setSessions((current) => current.map((s) => s.id === sessionId ? { ...s, title } : s));
    } catch {
      // AI 自动标题失败静默（非关键路径）
    } finally {
      setRenamingSessionId(null);
    }
  }

  async function persistSessionPath(sessionId: string, projectPath: string) {
    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath }),
      });
      setSessions((current) => current.map((s) => s.id === sessionId ? { ...s, projectPath } : s));
    } catch {
      // 路径持久化失败静默（非关键路径）
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
      setSelectedModel((current) => detail.session.defaultModel || current);
      // F per-session：切换会话同步 cwd（保留当前输入未提交的临时路径）
      if (typeof detail.session.projectPath === "string") {
        setProjectPath(detail.session.projectPath);
      }
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
      // L17：服务端 200 但 body 无 apiKey（异常态）——不能静默 return。
      // 此分支没建/没拿到 key，不占名额，与 L1064 的 429 分支同理：ref 重置为 false 允许重连重试，
      // 同时 setConfirmDialog 给出明确提示 + 恢复路径，避免用户卡在"Agent 已启动但未配置"且无错误反馈。
      if (!keyData.apiKey) {
        desktopKeyConfiguredRef.current = false;
        setConfirmDialog({
          message: `服务端响应异常${keyData.error ? `（${keyData.error}）` : "：未返回密钥"}。请稍后点「重新连接」重试，或刷新页面。`,
          onConfirm: () => setConfirmDialog(null),
        });
        return;
      }
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

  // P1-d 导出菜单 click outside 关闭
  useEffect(() => {
    if (!exportMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (exportMenuRef.current && target instanceof Node && exportMenuRef.current.contains(target)) return;
      setExportMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [exportMenuOpen]);

  // 全局快捷键：Esc 中断、Y/N 审批（用 ref 读最新值，effect 只绑一次，不每帧重绑）
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        // 弹层打开时 Esc 优先关弹层（让弹层自己的 onKeyDown 处理），不误中断 Agent
        if (commandOpen || quickMenuOpen || atMenuOpen || rollbackMenuOpen || projectPickerOpen || confirmDialog || rollbackPreview || contextView || slashMenuOpen) {
          return;
        }
        if (agentRunningRef.current) {
          e.preventDefault();
          cancelAgentRunRef.current();
        }
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
      // L12: 过滤操作系统按键自动重复（按住组合键时 ~20-30 次/秒翻转 commandOpen 会快速闪烁）
      if (e.repeat) return;
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

  // 任务 3：注册"点击通知 → 切到该 session 并聚焦窗口"的回调；监听权限变化刷新设置
  useEffect(() => {
    registerNotifyClickHandler((sessionId) => {
      setActiveSessionId(sessionId);
      setSidebarDrawerOpen(false);
      setAgentActionMessage("已切到任务完成的会话");
    });
    // 部分浏览器在用户从浏览器站点设置里改权限后不会触发事件，但挂载时刷新一次足够
    setNotifySettings(readNotifySettings());
    return () => registerNotifyClickHandler(null);
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
    // P2 sidebar 折叠持久化：从 localStorage 恢复折叠态
    const savedSidebar = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (savedSidebar === "true") setSidebarCollapsed(true);
    // 任务 5 onboarding：首次启动（localStorage 没有 onboarded 标记）显示引导
    if (!isOnboarded()) setShowOnboarding(true);
  }, []);

  const prevProjectPathRef = useRef("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = projectPath.trim();
    if (value) {
      window.localStorage.setItem(PROJECT_PATH_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(PROJECT_PATH_STORAGE_KEY);
    }
    // 切 cwd 清 claude session 映射（SDK resume 跨 cwd 不通，下条消息开新 session）
    if (prevProjectPathRef.current && prevProjectPathRef.current !== value && activeSessionId) {
      claudeSessionRef.current.delete(activeSessionId);
      persistClaudeSessionMap();
      setAgentActionMessage("项目目录已切换，下条消息将开新 AI 上下文");
    }
    prevProjectPathRef.current = value;
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

  // P2 长会话虚拟滚动：切换会话时把可见窗口重置回最近 MESSAGE_RENDER_CAP 条
  useEffect(() => {
    setVisibleCount(MESSAGE_RENDER_CAP);
  }, [activeSessionId]);

  // P2 长会话虚拟滚动：触顶 IntersectionObserver → prepend 更多历史消息
  useEffect(() => {
    const root = streamRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        const prevHeight = root.scrollHeight;
        setVisibleCount((current) => {
          const next = current + MESSAGE_RENDER_GROW;
          if (next === current) return current;
          // 标记需要保持滚动位置（防止新内容把用户视图往下推）
          isPrependingRef.current = true;
          prevScrollHeightRef.current = prevHeight;
          return next;
        });
      },
      { root, rootMargin: "0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [messages.length > visibleCount]);

  // P2 长会话虚拟滚动：prepend 后用 useLayoutEffect 在浏览器绘制前修正 scrollTop
  useLayoutEffect(() => {
    if (!isPrependingRef.current) return;
    isPrependingRef.current = false;
    const root = streamRef.current;
    if (!root) return;
    const delta = root.scrollHeight - prevScrollHeightRef.current;
    if (delta > 0) root.scrollTop += delta;
  }, [visibleCount]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  // P2 长会话虚拟滚动：messages 全量保留，但渲染窗口只取最近 visibleCount 条
  const visibleMessages = useMemo(
    () => messages.length > visibleCount ? messages.slice(messages.length - visibleCount) : messages,
    [messages, visibleCount],
  );
  const hiddenOlderCount = messages.length - visibleMessages.length;

  useEffect(() => {
    if (activeSession) setExecutionMode(normalizeExecutionMode(activeSession.mode));
  }, [activeSession?.id, activeSession?.mode]);

  const selectedModelInfo = useMemo(() => {
    return data?.models.find((model) => model.claudeCodeId === selectedModel) || data?.models[0] || null;
  }, [data?.models, selectedModel]);

  const filteredSessions = useMemo(() => {
    // 搜索模式：sessions 已是后端搜索结果，原样使用
    if (searchMode) return sessions;
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(query));
  }, [sessions, sessionSearch, searchMode]);

  // 任务 5 会话置顶：分两组（置顶 / 普通），各按原顺序（=updatedAt desc）保留
  const { pinnedSessionList, normalSessionList } = useMemo(() => {
    const pinnedSet = new Set(pinnedSessions);
    const pinned: StudioSession[] = [];
    const normal: StudioSession[] = [];
    for (const s of filteredSessions) {
      if (pinnedSet.has(s.id)) pinned.push(s);
      else normal.push(s);
    }
    return { pinnedSessionList: pinned, normalSessionList: normal };
  }, [filteredSessions, pinnedSessions]);

  function togglePinSession(sessionId: string) {
    setPinnedSessions((current) => {
      const exists = current.includes(sessionId);
      const next = exists ? current.filter((id) => id !== sessionId) : [...current, sessionId];
      persistPinned(next);
      showNotice(exists ? "已取消置顶" : "已置顶");
      return next;
    });
  }

  // 任务 5 快捷键：Ctrl+1~9 切换到侧边栏第 N 个会话（不分置顶/普通）
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      const code = e.code;
      const match = /^Digit([1-9])$/.exec(code);
      if (!match) return;
      // 输入元素聚焦时不触发，避免破坏用户输入
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const idx = Number(match[1]) - 1;
      const ordered = [...pinnedSessionList, ...normalSessionList];
      const target2 = ordered[idx];
      if (!target2) return;
      e.preventDefault();
      setActiveSessionId(target2.id);
      setSidebarDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedSessionList, normalSessionList]);

  // 搜索防抖：200ms 静止后触发后端全文搜索
  const sessionSearchTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionSearchTimerRef.current) {
      window.clearTimeout(sessionSearchTimerRef.current);
    }
    const value = sessionSearch;
    // 空搜索：恢复非搜索模式，重新拉取列表
    if (!value.trim()) {
      if (searchMode) {
        setSearchMode(false);
        void load();
      }
      return;
    }
    sessionSearchTimerRef.current = window.setTimeout(() => {
      void runSessionSearch(value);
    }, 250);
    return () => {
      if (sessionSearchTimerRef.current) window.clearTimeout(sessionSearchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionSearch]);

  // 触底加载更多：仅在非搜索模式且还有未加载会话时触发
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (searchMode) return;
    const node = loadMoreSentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMoreSessions();
        }
      },
      { root: sessionListRef.current, rootMargin: "60px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMode, sessions.length, sessionsTotal]);

  const installedSkillSet = useMemo(() => {
    return new Set(agentStatus.state === "online" && agentStatus.skills ? agentStatus.skills.installed : []);
  }, [agentStatus]);

  // 会话上下文占用：ratio 基于「最近一次 result 的真实 prompt 大小」估算当前窗口占用，
  // total 仅作为「会话累计输入消耗」独立展示——之前用累计 inputTokens / 单次窗口 200K 会让 ratio 虚高，
  // 在实际窗口还很宽裕时误触发 /compact，破坏有效上下文。
  const sessionContextInfo = useMemo(() => {
    let total = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    let lastPromptTokens = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.kind === "result" && m.usage) {
        const inT = Number(m.usage.inputTokens ?? 0);
        const cr = Number(m.usage.cacheRead ?? 0);
        const cc = Number(m.usage.cacheCreation ?? 0);
        if (lastPromptTokens === 0) lastPromptTokens = inT + cr + cc;
        total += inT;
        cacheRead += cr;
        cacheCreation += cc;
      }
    }
    const denom = total + cacheRead + cacheCreation;
    const hitRate = denom > 0 ? Math.round((cacheRead / denom) * 100) : 0;
    const ratio = CONTEXT_WINDOW_TOKENS > 0 ? Math.min(1, lastPromptTokens / CONTEXT_WINDOW_TOKENS) : 0;
    const level: "ok" | "warn" | "danger" = ratio < 0.25 ? "ok" : ratio <= 0.75 ? "warn" : "danger";
    return { total, cacheRead, cacheCreation, hitRate, ratio, level, lastPromptTokens };
  }, [messages]);

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

  // 任务 1：DiffBlock 逐块 Apply 上下文。仅在有 cwd 且 agent 已就绪时启用按钮
  const diffApplyContext: DiffApplyContext | null = useMemo(() => {
    const cwd = projectPath.trim();
    if (!cwd) return null;
    const base = agentBaseUrl();
    if (!base) return null;
    return {
      cwd,
      agentBase: base,
      agentAuthHeaders: agentAuthHeaders,
      onApplied: (cpId) => {
        // 复用 checkpoint 列表：Apply 后 agent 拍了新快照，UI 上加一条回滚点
        if (cpId) {
          setCheckpoints((prev) => prev.some((c) => c.id === cpId) ? prev : [...prev, { id: cpId, label: "apply-hunk", createdAt: Math.floor(Date.now() / 1000) }]);
        }
        showNotice("已应用该改动块");
      },
      onError: (msg) => setError(msg),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, agentStatus.state, agentToken]);

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
    // 任务 4：切到 yolo 时弹危险确认；切其他模式直接执行
    if (nextMode === "yolo" && executionMode !== "yolo") {
      setConfirmDialog({
        message: "Yolo 模式：本机 Agent 对所有工具调用全部自动放行，不再弹审批。\n\n仅在你完全信任任务和目录时使用。确认继续？",
        onConfirm: () => void persistExecutionMode(nextMode),
      });
      return;
    }
    await persistExecutionMode(nextMode);
  }

  async function persistExecutionMode(nextMode: ExecutionMode) {
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
          title: "新任务",
          defaultModel: selectedModel,
          mode: executionMode,
          projectPath: projectPath.trim() || undefined,
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
    const previousPinned = pinnedSessions; // L8：捕获 pinned 快照，DELETE 失败时连同 sessions 一起回滚，避免幽灵 ID
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    const nextActiveId = sessionId === activeSessionId ? nextSessions[0]?.id || "" : activeSessionId;
    setSessions(nextSessions);
    setActiveSessionId(nextActiveId);
    if (!nextActiveId) setMessages([]);
    // 任务 5 删除会话时同步从 pinned 列表移除，避免幽灵 ID 残留
    setPinnedSessions((current) => {
      if (!current.includes(sessionId)) return current;
      const next = current.filter((id) => id !== sessionId);
      persistPinned(next);
      return next;
    });

    try {
      await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (nextActiveId) await loadSession(nextActiveId);
    } catch (err) {
      setSessions(previousSessions);
      setActiveSessionId(activeSessionId);
      // L8：失败回滚 pinnedSessions 内存 + localStorage，服务端会话还在但本机 pinned 已被乐观删，
      // 不回滚会留"服务端存在但 pinned 列表缺失"的脏状态（用户再也看不到该会话被置顶）。
      setPinnedSessions(previousPinned);
      persistPinned(previousPinned);
      setError(err instanceof ApiError ? err.message : "会话删除失败");
    } finally {
      setSavingStudioItem(false);
    }
  }

  async function sendMessage(contentArg?: string) {
    // 运行中发新：自动取消当前再发（对照 Cursor/ChatGPT 的 Stop 行为，不再静默丢弃）
    if (agentRunning) {
      await cancelAgentRun();
    }
    // 新一轮重置 TodoWrite 进度面板（上轮的清单不再相关）
    setTodoList([]);
    let content = (contentArg ?? prompt).trim();
    // 任务 4 斜杠命令分发：完整匹配命令时按 kind 走对应流程
    const matchedSlashCmd = SLASH_COMMANDS.find((c) => c.cmd === content);
    if (matchedSlashCmd) {
      setPrompt("");
      if (matchedSlashCmd.kind === "tab" && matchedSlashCmd.tab) {
        setInspectorTab(matchedSlashCmd.tab);
        setAgentActionMessage(`已切换：${matchedSlashCmd.desc}`);
        return;
      }
      if (matchedSlashCmd.kind === "notice") {
        // 任务 2：/prompt 打开提示库抽屉
        if (matchedSlashCmd.cmd === "/prompt") {
          setPromptLibraryOpen(true);
          return;
        }
        setAgentActionMessage(matchedSlashCmd.notice || matchedSlashCmd.desc);
        return;
      }
      // send 类：/init 翻译为具体提示词（让 Claude 扫描并生成 CLAUDE.md）
      if (matchedSlashCmd.cmd === "/init") {
        content = "请扫描当前项目并生成 CLAUDE.md，记录：项目结构、关键依赖、运行/构建/测试命令、约定与注意事项。";
      }
      // /clear /compact 继续走下面原有逻辑
    }
    // /clear：删 claude session 映射（下次开新 session，不重放旧上下文），不发 /clear 给 Agent
    if (content === "/clear") {
      if (activeSessionId) { claudeSessionRef.current.delete(activeSessionId); persistClaudeSessionMap(); }
      setPrompt("");
      setAgentActionMessage("已清空 AI 上下文（下条消息开新会话）");
      return;
    }
    if (content === "/compact") {
      setPrompt("");
      setAgentActionMessage("SDK 会在上下文将满时自动压缩；如需重置请用 /clear");
      return;
    }
    if (!content && attachments.length === 0) return;
    if (!projectPath.trim()) {
      setError("请先选择项目目录");
      return;
    }
    // 新一轮用户输入：重置 session 级 auto-accept（避免上轮的"全部允许"延续到本轮）
    if (autoAcceptSession) {
      setAutoAcceptSession(false);
      const socket = agentSocketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "auto_accept", value: false }));
      }
    }
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
            title: content.slice(0, 48) || "代码审查",
            defaultModel: selectedModel,
            mode: executionMode,
            projectPath: projectPath.trim() || undefined,
          }),
        });
        sessionId = created.session.id;
        setSessions((current) => [created.session, ...current]);
        setActiveSessionId(sessionId);
      } else {
        // D-2 自动标题：已有会话首条消息时，如果标题仍是默认值，用首句截取 24 字作为标题
        const current = sessions.find((s) => s.id === sessionId);
        const isDefaultTitle = !current || current.title === "新任务" || current.title === "New task" || current.title === "New Studio Session";
        const isEmptySession = messages.length === 0;
        if (isDefaultTitle && isEmptySession && content.trim()) {
          const autoTitle = content.replace(/\s+/g, " ").trim().slice(0, 24);
          void updateSessionTitle(sessionId, autoTitle);
        }
        // F per-session：把当前 projectPath 持久化到 session（首次或路径变更时）
        const pathTrim2 = projectPath.trim();
        if (pathTrim2 && current?.projectPath !== pathTrim2) {
          void persistSessionPath(sessionId, pathTrim2);
        }
      }

      // 编辑模式：删除编辑点消息及其后所有，再以新内容重发
      if (editingMsgId) {
        const editMsg = messages.find((m) => m.id === editingMsgId);
        const editCreatedAt = editMsg?.createdAt ?? 0;
        const editId = editingMsgId;
        setEditingMsgId(null);
        setMessages((current) => current.filter((m) => m.createdAt < editCreatedAt));
        // SDK resume 无法从中间截断历史，编辑 = 开新 claude session（丢被编辑消息之后的上下文）
        claudeSessionRef.current.delete(sessionId);
        persistClaudeSessionMap();
        try {
          await fetchApi(`/api/studio/sessions/${encodeURIComponent(sessionId)}/messages?from=${encodeURIComponent(editId)}`, { method: "DELETE" });
        } catch {
          // 删除失败不阻塞重发
        }
      }

      // 附件：文本类读取内容注入 prompt；image/* 走 Claude vision 不拼文本；其余二进制提示用 @路径
      let attachmentText = "";
      const imageAttachments: Array<{ mediaType: string; data: string }> = [];
      for (const file of attachments) {
        const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type || "") && file.base64 && file.mediaType;
        if (isImage && file.base64 && file.mediaType) {
          imageAttachments.push({ mediaType: file.mediaType, data: file.base64 });
          attachmentText += `\n\n附件 ${file.name}（已作为图片附加，Claude 会直接查看）`;
          continue;
        }
        const isText = file.size < 100 * 1024 && /\.(txt|md|markdown|json|ya?ml|js|cjs|mjs|ts|tsx|jsx|py|go|rs|java|c|cpp|cs|rb|php|sh|bash|css|scss|html|xml|csv|tsv|sql|toml|ini|env|gitignore|lock)$/i.test(file.name);
        if (isText) {
          try {
            const text = (await file.file?.text()) || "";
            attachmentText += `\n\n附件 ${file.name}：\n\`\`\`\n${text.slice(0, 20000)}${text.length > 20000 ? "\n... (截断)" : ""}\n\`\`\``;
          } catch {
            attachmentText += `\n\n附件 ${file.name}（读取失败，请用 @文件路径 让 Agent 读取）`;
          }
        } else {
          attachmentText += `\n\n附件 ${file.name}（${formatFileSize(file.size)}，二进制/图片请用 @文件路径 让 Agent 读取）`;
        }
      }
      const createdMessage = await fetchApi<{ message: StudioMessage }>(
        `/api/studio/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: `${content}${attachmentText}`.trim() }),
        }
      );
      setMessages((current) => [...current, createdMessage.message]);
      // P2-5 消息级撤回：记下本次发送，给 5 秒撤回窗口（agentRunning 期间也可点）
      setLastSentForUndo({ sessionId, userMsgId: createdMessage.message.id, userContent: content });
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setLastSentForUndo(null), 5000);
      const completed = await runAgentTask(sessionId, `${content}${attachmentText}`.trim(), imageAttachments);
      if (completed) {
        setPrompt("");
        // Vision：清掉 image objectUrl 防 内存泄漏
        attachments.forEach((a) => { if (a.objectUrl) URL.revokeObjectURL(a.objectUrl); });
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
  // P1-c：暴露最新 saveAssistantMessage 给 cancelAgentRun（useCallback 闭包不更新）
  saveAssistantMessageRef.current = saveAssistantMessage;

  async function runAgentTask(sessionId: string, content: string, images: Array<{ mediaType: string; data: string }> = []): Promise<boolean> {
    // 防御性兜底：启动新任务前清掉可能残留的取消标记，阻断「无 socket 时 cancelAgentRun 置位 → flag 滞留 → 下次断走 cancel 分支」的卡死链路。
    agentCancelledRef.current = false;
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
    // P1-c：暴露 stream 快照给 cancelAgentRun，关 socket 前据此落库
    agentStreamSnapshotRef.current = { text: "", sessionId, streamMessageId };

    setRunningSessionId(sessionId);
    // 任务 3：记录任务开始时间，result 到达时据此判断是否触发桌面通知
    taskStartInfoRef.current = { sessionId, startedAt: Date.now() };
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
      // P1-c：同步 streamText 到 ref（cancelAgentRun 读这里）
      streamText = next || "";
      if (agentStreamSnapshotRef.current) agentStreamSnapshotRef.current.text = streamText;
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
      // 任务 5：指数退避重连 + 状态指示（绿/黄/红 圆点）
      const RECONNECT_BACKOFFS_MS = [1000, 2000, 5000, 10000, 30000];
      let reconnectAttempts = 0;
      let socket: WebSocket | null = null;
      let heartbeatTimer: number | null = null;

      const finalize = async (ok: boolean, message: string) => {
        const redacted = redactSecretText(message, newKey, currentToken).trim();
        const finalMessage = ok
          ? (redacted || "Agent 已完成，但没有返回文本输出。")
          : `Agent 执行失败：\n${redacted || "Agent 执行失败"}`;
        const result = await finishWithMessage(finalMessage, ok);
        setAgentActionBusy("");
        setAgentRunning(false);
        setRunningSessionId((cur) => (cur === sessionId ? null : cur));
        if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = null; }
        agentSocketRef.current = null;
        agentRequestIdRef.current = "";
        setWsStatus("disconnected");
        setWsReconnectAttempt(0);
        resolve(result);
      };

      const setupSocket = () => {
        if (settled) return;
        let nextSocket: WebSocket;
        try {
          nextSocket = new WebSocket(agentWebSocketUrl(baseUrl, token));
        } catch (err) {
          const message = redactSecretText(err instanceof Error ? err.message : "Agent WebSocket 创建失败", newKey, currentToken);
          void finalize(false, `Agent 执行失败：\n${message}`);
          return;
        }
        socket = nextSocket;
        agentSocketRef.current = nextSocket;
        agentRequestIdRef.current = requestId;
        setWsStatus("connecting");

        nextSocket.onopen = () => {
          reconnectAttempts = 0; // 连接成功后重置重连计数（下次断线重新开始）
          setWsReconnectAttempt(0);
          setWsStatus("connected");
          setAgentActionMessage("Agent SDK 已连接，正在启动任务");
          updateStreamMessage("Agent SDK 已连接，正在启动任务...");
          // 心跳：每 25s ping，防半开连接 stall（Agent 后端已支持 ping/pong）
          if (heartbeatTimer) window.clearInterval(heartbeatTimer);
          heartbeatTimer = window.setInterval(() => {
            if (nextSocket.readyState === WebSocket.OPEN) {
              nextSocket.send(JSON.stringify({ type: "ping", requestId }));
            }
          }, 25000);
          nextSocket.send(JSON.stringify({
            type: "run",
            requestId,
            prompt: content,
            // Vision：图片走 Claude image content block（agent 透传 SDK query）
            images: images.length > 0 ? images : undefined,
            resume: claudeSessionRef.current.get(sessionId) || undefined,
            mode: executionMode,
            model: selectedModel,
            cwd: projectPath.trim(),
            maxTurns: DEFAULT_AGENT_MAX_TURNS,
          }));
        };

              nextSocket.onmessage = (event) => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(String(event.data || "{}")) as Record<string, unknown>;
        } catch {
          void finalize(false, "Agent WebSocket 返回了无法解析的数据。");
          nextSocket.close();
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
          const fullRaw = typeof body.fullContent === "string" ? redactSecretText(body.fullContent, newKey, currentToken) : null;
          const fullTruncCap = Boolean(body.fullTruncatedByCap);
          setMessages((current) => current.map((m) =>
            (m.kind === "tool" && m.toolUseId && m.toolUseId === toolUseId)
              ? {
                  ...m,
                  result: rc,
                  resultFull: fullRaw || undefined,
                  resultTruncatedCap: fullTruncCap || undefined,
                  isError,
                  toolState: isError ? ("error" as const) : ("done" as const),
                }
              : m
          ));
          return;
        }
        if (type === "todo_list") {
          const todos = Array.isArray(body.todos) ? body.todos.map((t) => {
            const item = t as { content?: string; status?: string; activeForm?: string };
            const status = item.status === "completed" ? "completed" : item.status === "in_progress" ? "in_progress" : "pending";
            return {
              content: String(item.content || ""),
              status: status as "pending" | "in_progress" | "completed",
              activeForm: String(item.activeForm || item.content || ""),
            };
          }) : [];
          setTodoList(todos);
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
          // 任务 1 成本面板：同步把这一条 usage 追加到 localStorage（在 setState 外只调一次，避免严格模式双写）
          appendUsageRecord({
            sessionId,
            model: selectedModel,
            inputTokens: Number(body.inputTokens || 0),
            outputTokens: Number(body.outputTokens || 0),
            cacheCreation: Number(body.cacheCreation || 0),
            cacheRead: Number(body.cacheRead || 0),
            timestamp: Math.floor(Date.now() / 1000),
          });
          // 触发一次 usage 快照刷新（让 CostPanel 即使当前已打开也能看到新数据）
          setUsageVersion((v) => v + 1);
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
              usage: { inputTokens: Number(body.inputTokens || 0), outputTokens: Number(body.outputTokens || 0), costUsd: Number(body.costUsd || 0), cacheCreation: Number(body.cacheCreation || 0), cacheRead: Number(body.cacheRead || 0) },
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
          // L18：用户已取消时跳过 finalize（cancelAgentRun 已在负责落库 + 提示"已取消"），
          // 避免 error 帧与取消竞态触发二次失败收尾。关 socket 让 onclose 走取消路径收尾。
          if (agentCancelledRef.current) {
            try { nextSocket.close(); } catch { /* ignore */ }
            return;
          }
          void finalize(false, String(body.error || "Agent WebSocket 执行失败"));
          nextSocket.close();
          return;
        }
        if (type === "result") {
          // L13 + L18：用户已取消时 result 帧到达也短路。
          // cancelAgentRun 第一步就置 agentCancelledRef.current=true（早于其内部 POST #1 await），
            // 因此无论 result 帧在 await 窗口内还是其后到达都能被这里拦下，跳过 finalize/finishWithMessage 的
          // 二次落库，避免 DB 留下孤儿 assistant 消息（下次 loadSession 会显示重复消息），
          // 同时避免给已取消任务弹出"任务完成/失败"通知。关 socket 让 onclose 走取消路径收尾。
          if (agentCancelledRef.current) {
            try { nextSocket.close(); } catch { /* ignore */ }
            return;
          }
          const ok = body.ok !== false;
          // 存 claude session_id：首次拿到后续 run resume 续上下文
          const claudeSid = String(body.claudeSessionId || "");
          if (claudeSid) { claudeSessionRef.current.set(sessionId, claudeSid); persistClaudeSessionMap(); }
          // resume 失败兜底：session 过期/被清时清映射，下次开新 session（不阻塞使用）
          if (!ok && /session|resume|not found/i.test(String(body.stderr || body.error || ""))) {
            claudeSessionRef.current.delete(sessionId); persistClaudeSessionMap();
          }
          const output = redactSecretText(String(body.output || streamText || ""), newKey, currentToken);
          const stderr = redactSecretText(String(body.stderr || body.error || ""), newKey, currentToken);
          setAgentActionMessage(ok ? "Agent 执行完成" : "Agent 执行失败");
          // 任务 3：满足条件时触发桌面通知（页面不在前台 或 任务时长 > 30s）
          const taskStart = taskStartInfoRef.current;
          if (taskStart && taskStart.sessionId === sessionId) {
            const sessionTitle = sessions.find((s) => s.id === sessionId)?.title;
            maybeNotifyTaskComplete({
              sessionId,
              sessionTitle,
              startedAt: taskStart.startedAt,
              finishedAt: Date.now(),
              ok,
              lastAssistantText: ok ? output : stderr,
            });
            taskStartInfoRef.current = null;
          }
          void finalize(ok, ok ? output : buildAgentFailureMessage(body, 0, output, stderr));
          nextSocket.close();
        }
      };

        nextSocket.onerror = () => {
          // 任务 5：不在此 finalize（避免重复触发），由 onclose 决定重连或失败收尾
          // 若连接尚未建立，onclose 会立即跟随触发并启动重连
        };

        nextSocket.onclose = () => {
          if (settled) return;
          // 用户主动取消：跳过 finalize / 重连（cancelAgentRun 已提示"已取消"）
          if (agentCancelledRef.current) {
            agentCancelledRef.current = false;
            settled = true;
            setWsStatus("disconnected");
            setWsReconnectAttempt(0);
            if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = null; }
            agentSocketRef.current = null;
            agentRequestIdRef.current = "";
            setRunningSessionId((cur) => (cur === sessionId ? null : cur));
            // 关键：必须 resolve 掉外层 Promise，否则 sendMessage 的 await runAgentTask(...) 永久挂起，
            // finally 中的 setSavingStudioItem(false) 不执行，savingStudioItem 卡住导致回车键/发送按钮失效。
            // cancelAgentRun 已自行处理 setAgentRunning/setAgentActionBusy/snapshot 落库，这里不重复触发渲染。
            resolve(false);
            return;
          }
          // 任务 5 自动重连：非主动取消 + 未完成 + 重连次数未耗尽 → 指数退避重试
          if (reconnectAttempts < RECONNECT_BACKOFFS_MS.length) {
            const delay = RECONNECT_BACKOFFS_MS[reconnectAttempts];
            reconnectAttempts += 1;
            setWsReconnectAttempt(reconnectAttempts);
            setWsStatus("reconnecting");
            setAgentActionMessage(`Agent 连接断开，${Math.round(delay / 1000)} 秒后重连（第 ${reconnectAttempts}/${RECONNECT_BACKOFFS_MS.length} 次）`);
            window.setTimeout(() => {
              if (settled || agentCancelledRef.current) return;
              setupSocket();
            }, delay);
            return;
          }
          // 重连耗尽：finalize 失败
          void finalize(false, "Agent WebSocket 断开后多次重连失败。请确认本地 Sparkloom Agent 正在运行后重试。");
        };
      };

      setupSocket();
    });
  }

  const cancelAgentRun = useCallback(async () => {
    // P1-c：关 socket 前先把已生成的 streamText 落库（避免 cancel 丢失已产出内容）
    const snapshot = agentStreamSnapshotRef.current;
    const placeholderPatterns = [
      /^Agent 正在连接本机 SDK\.{3}?$/,
      /^Agent SDK 已连接，正在启动任务\.{3}?$/,
      /^Agent 正在处理\.{3}?$/,
    ];
    const meaningful = snapshot && snapshot.text.trim().length > 0
      && !placeholderPatterns.some((re) => re.test(snapshot.text.trim()));
    if (meaningful) {
      try {
        await saveAssistantMessageRef.current(snapshot.sessionId, snapshot.text, snapshot.streamMessageId);
      } catch {
        // 落库失败静默，继续走取消流程
      }
    }
    agentStreamSnapshotRef.current = null;
    const socket = agentSocketRef.current;
    const requestId = agentRequestIdRef.current;
    // 只有存在活动 socket、需要靠 onclose cancel 分支复位时才置 flag（与 onclose 内的清位配对）。
    // 无 socket 时（典型：切换会话的 useEffect 触发）若置位，onclose 不会触发，flag 永久滞留 true，
    // 之后任何一次任务 WS 异常断开会进入 cancel 分支直接 return：不重连、不 finalize、不 resolve，UI 卡死。
    if (socket) {
      agentCancelledRef.current = true;
      if (socket.readyState === WebSocket.OPEN && requestId) {
        socket.send(JSON.stringify({ type: "cancel", requestId }));
      }
      // 等 socket 真正 close（让 onclose 跳过 finalize 失败），再清状态；2s 兜底
      await new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.addEventListener("close", () => resolve(), { once: true });
        try { socket.close(); } catch {}
        window.setTimeout(resolve, 2000);
      });
    }
    agentSocketRef.current = null;
    agentRequestIdRef.current = "";
    setAgentRunning(false);
    setAgentActionBusy("");
    setAgentActionMessage(meaningful ? "已停止并保留已生成内容" : "Agent 任务已取消");
  }, []);

  const respondApproval = useCallback((approvalId: string, decision: "allow" | "deny") => {
    if (!approvalId || respondingRef.current) return;
    respondingRef.current = approvalId;
    setRespondingApprovalId(approvalId);
    // 取出当前审批消息的元信息用于审计（必须在 setMessages 之前快照）
    const target = messagesForHotkeysRef.current.find((m) => m.approvalId === approvalId);
    setMessages((current) => current.map((m) =>
      m.approvalId === approvalId ? { ...m, toolState: decision === "allow" ? "done" : "error", approvalId: undefined } : m
    ));
    const socket = agentSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "approval_respond", approvalId, decision }));
    }
    // J-2 审计日志：fire-and-forget，不阻塞 UI（失败也不影响审批流程）
    try {
      const sessionId = activeSessionIdRef.current;
      const auditBody = {
        approvalId,
        decision,
        sessionId: sessionId || undefined,
        toolName: target?.toolName,
        risk: target?.risk,
        inputSummary: target?.toolInput ? String(target.toolInput).slice(0, 200) : undefined,
      };
      void fetch("/api/studio/approvals/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(auditBody),
        credentials: "same-origin",
      }).catch(() => { /* 审计失败不阻塞 */ });
    } catch {
      // 审计异常静默
    }
    window.setTimeout(() => { respondingRef.current = null; setRespondingApprovalId(null); }, 800);
  }, []);

  // E-2 全部允许本次：开 socket 级 auto-accept；agent 在本任务内对非危险审批直接放行
  const enableAutoAccept = useCallback(() => {
    const socket = agentSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "auto_accept", value: true }));
    }
    setAutoAcceptSession(true);
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

  const startEditMessage = useCallback((msg: StudioMessage) => {
    setPrompt(msg.content);
    setEditingMsgId(msg.id);
  }, []);

  // P2-1 分支对话：从此消息分叉到新 session（原 session 完整保留）
  // 复制 session + 截断点之前的 messages 到新 session_id；切到新 session 并把该消息回填到输入框待编辑重发
  const forkMessage = useCallback(async (msg: StudioMessage) => {
    if (!activeSessionId) return;
    const sid = activeSessionId;
    try {
      const created = await fetchApi<{ session: StudioSession; messageCount: number }>(
        `/api/studio/sessions/${encodeURIComponent(sid)}/fork`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beforeMessageId: msg.id, titleSuffix: "[fork]" }),
        }
      );
      // 把新 session 放进列表头，激活它，清当前消息视图，loadSession 会拉新 session 的 messages
      setSessions((current) => [created.session, ...current]);
      setMessages([]);
      setCheckpoints([]);
      setEditingMsgId(null);
      setActiveSessionId(created.session.id);
      // 回填被分叉的消息内容到输入框，等用户编辑后发送（开新 claude session 重放历史）
      setPrompt(msg.content);
      showNotice(`已从此处分叉到新会话「${created.session.title}」（复制 ${created.messageCount} 条历史）。下方可编辑后发送，原会话不受影响。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分叉会话失败");
    }
  }, [activeSessionId, showNotice]);

  // P2-2 /context 调试视图：拉本机 Agent 上下文来源 + 当前 session messages，组合展示
  const openContextView = useCallback(async () => {
    setContextView({ loading: true, error: null, agent: null, messages: [], totalTokens: 0, contextWindow: 0 });
    const baseUrl = agentBaseUrl();
    const token = agentToken || readStoredAgentToken();
    // 先把当前内存里的 messages 拍一份（按 createdAt 排序）
    const msgs = [...messages].sort((a, b) => a.createdAt - b.createdAt).map((m) => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
    }));
    // token 估算：粗略 4 字符 ≈ 1 token（英文）；中文按 1.5 字符 ≈ 1 token 折中用 2.5 字符
    const estimateTokens = (text: string) => {
      const ascii = (text.match(/[\x00-\x7F]/g) || []).length;
      const non = text.length - ascii;
      return Math.ceil(ascii / 4 + non / 1.5);
    };
    const totalTokens = msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    // StudioModel 没携带 contextWindow 字段，使用 Claude 默认参考值 200K
    const contextWindow = 200000;
    if (!baseUrl || !token) {
      setContextView({ loading: false, error: "本机 Agent 未连接，无法读取上下文来源", agent: null, messages: msgs, totalTokens, contextWindow });
      return;
    }
    try {
      const cwdHint = activeSession?.projectPath || "";
      const res = await fetch(`${baseUrl}/claude/context?cwd=${encodeURIComponent(cwdHint)}`, {
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const agent = await res.json() as {
        agentVersion: string;
        configDir: string;
        userDir: string;
        cwd: string | null;
        gateway: { configured: boolean; baseUrl: string | null; configFile: string; model: string | null };
        systemPromptSources: Array<{ kind: string; path: string; scope: string; exists: boolean; size: number }>;
        note: string;
      };
      setContextView({ loading: false, error: null, agent, messages: msgs, totalTokens, contextWindow });
    } catch (err) {
      setContextView({ loading: false, error: err instanceof Error ? err.message : "读取上下文失败", agent: null, messages: msgs, totalTokens, contextWindow });
    }
  }, [messages, activeSession, agentBaseUrl, agentToken, agentAuthHeaders, readStoredAgentToken]);

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
    // E-4 敏感文件保护：扫描当前 messages 中所有 Edit/Write/MultiEdit 涉及的文件路径，
    // 命中敏感模式（.env / package.json / package-lock.json / node_modules / 密钥凭据等）则警告
    const sensitivePatterns: Array<RegExp> = [
      /(^|\/)\.env(\.|$)/i,
      /(^|\/)package(-lock)?\.json$/i,
      /(^|\/)pnpm-lock\.yaml$/i,
      /(^|\/)yarn\.lock$/i,
      /(^|\/)node_modules\//i,
      /(^|\/)\.git\//i,
      /(secret|credential|id_rsa|id_ed25519)/i,
    ];
    const touchedFiles = new Set<string>();
    for (const m of messages) {
      if (m.kind === "tool" && /^(Edit|Write|MultiEdit)$/.test(String(m.toolName || ""))) {
        const info = parseEditInput(m.toolInput);
        if (info?.filePath) touchedFiles.add(info.filePath);
      }
    }
    const sensitiveHits = Array.from(touchedFiles).filter((f) => sensitivePatterns.some((re) => re.test(f)));
    setRollbackMenuOpen(false);

    // E-3 先开 modal 显示 loading，再异步拉 diff
    setRollbackPreview({ cpId: checkpointId, label, sensitiveHits, loading: true, diff: null, error: null });

    const baseUrl = agentBaseUrl();
    const token = agentToken || readStoredAgentToken();
    if (!baseUrl || !token) {
      setRollbackPreview((p) => p ? { ...p, loading: false, error: "本机 Agent 未连接，无法加载 diff" } : p);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/checkpoint/${encodeURIComponent(checkpointId)}/diff`, {
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const diff = await res.json() as {
        added: string[];
        modified: string[];
        deleted: string[];
        totalChanged: number;
        addedTotal: number;
        modifiedTotal: number;
        deletedTotal: number;
        snapshotedAt: number | null;
        cwd: string;
      };
      setRollbackPreview((p) => p ? { ...p, loading: false, diff } : p);
    } catch (err) {
      setRollbackPreview((p) => p ? { ...p, loading: false, error: err instanceof Error ? err.message : "加载 diff 失败" } : p);
    }
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
    // 任务 4 斜杠命令补全：菜单打开时优先处理 ↑↓ Enter Esc
    if (slashMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashFiltered.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        slashSuppressedRef.current = true;
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const cmd = slashFiltered[slashIndex];
        if (cmd) {
          // 补全：替换末尾的 /word 为完整命令（带尾随空格，方便继续输入参数）
          setPrompt((p) => p.replace(/\/[A-Za-z0-9_-]*$/, cmd.cmd + " "));
          slashSuppressedRef.current = true;
        }
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!savingStudioItem && !agentRunning && (prompt.trim() || attachments.length > 0)) {
      void sendMessage();
    }
  }

  // 任务 4 斜杠命令补全：选中某命令（鼠标点击）
  function pickSlashCommand(cmd: SlashCommand) {
    setPrompt((p) => p.replace(/\/[A-Za-z0-9_-]*$/, cmd.cmd + " "));
    slashSuppressedRef.current = true;
  }

  async function copyText(label: string, value: string) {
    if (!value) return;
    // P2-a 复制失败 fallback：navigator.clipboard 在非 HTTPS webview 可能不可用或 reject
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // 仍然失败静默（UI copied 状态仍亮，避免阻塞）
      }
    }
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    addFilesAsAttachments(files);
    event.target.value = "";
  }

  function addFilesAsAttachments(files: File[]) {
    if (!files || files.length === 0) return;
    // M2 防 WS 帧风暴：本机 Agent 单帧硬上限 2MB，base64 膨胀约 4/3 + JSON 外壳，
    // 取 1.4MB 作为原图字节上限，给 prompt 文本和其他字段留余量，确保 base64 后单帧 < 2MB。
    const IMAGE_MAX_BYTES = 1.4 * 1024 * 1024;
    const rejected: string[] = [];
    const accepted = files.filter((file) => {
      const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type || "");
      if (isImage && file.size > IMAGE_MAX_BYTES) {
        rejected.push(`${file.name}（${formatFileSize(file.size)}）`);
        return false;
      }
      return true;
    });
    if (rejected.length > 0) {
      setError(`图片过大：${rejected.join("、")}。本机 Agent 单帧上限约 2MB（原图需 < 1.4MB）。请压缩后再传，或改用 @文件路径 让 Agent 直接读取本地文件。`);
    }
    if (accepted.length === 0) {
      setInspectorTab("files");
      return;
    }
    setAttachments((current) => [
      ...current,
      ...accepted.map((file) => {
        const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type || "");
        // Vision：image/* 立刻创建 objectUrl 显示缩略图，并异步 base64 编码供 sendMessage 使用
        const objectUrl = isImage ? URL.createObjectURL(file) : undefined;
        const item: AttachmentItem = {
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          size: file.size,
          type: file.type || "file",
          file,
          objectUrl,
          mediaType: isImage ? file.type : undefined,
        };
        if (isImage) {
          // 异步读 base64，存到 item.base64（不阻塞渲染）
          file.arrayBuffer().then((buf) => {
            const bytes = new Uint8Array(buf);
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            const base64 = btoa(binary);
            setAttachments((prev) => prev.map((a) => a.id === item.id ? { ...a, base64 } : a));
          }).catch(() => { /* base64 失败时回退 @路径 */ });
        }
        return item;
      }),
    ]);
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

  // 任务 4：命令面板增强——按 group 分类，渲染时分组显示。空查询保持原有顺序，有查询时合并过滤。
  type CommandItem = { id: string; label: string; hint?: string; group: string; run: () => void };
  const commandList: CommandItem[] = [];
  // 操作组：会话级动作
  commandList.push({ id: "op-new", label: "新建会话", group: "操作", run: () => createSession() });
  commandList.push({ id: "op-clear-context", label: "清空当前上下文", hint: "/clear · 下条消息开新 AI 会话", group: "操作", run: () => applyQuickAction("/clear") });
  commandList.push({ id: "op-compact", label: "压缩当前上下文", hint: "/compact · SDK 自动管理", group: "操作", run: () => applyQuickAction("/compact") });
  commandList.push({ id: "op-clear-others", label: "清理其他会话", group: "操作", run: () => clearOtherSessions() });
  commandList.push({ id: "op-export-md", label: "导出当前会话 · Markdown", hint: "下载 .md", group: "操作", run: () => triggerExport("md") });
  commandList.push({ id: "op-export-json", label: "导出当前会话 · JSON", hint: "下载 .json（含 messages 数组）", group: "操作", run: () => triggerExport("json") });
  commandList.push({ id: "op-import", label: "导入会话", hint: ".json 或 .md（仅历史回看）", group: "操作", run: () => importInputRef.current?.click() });
  commandList.push({ id: "op-show-context", label: "显示当前上下文", hint: "SDK 加载的来源 + token 估算", group: "操作", run: () => { void openContextView(); } });
  // 模式组
  EXECUTION_MODES.forEach((m) => commandList.push({ id: `mode-${m.id}`, label: `切换模式 · ${m.label}`, hint: m.title, group: "模式", run: () => updateExecutionMode(m.id) }));
  // 模型组
  data.modelGroups.forEach((g) => g.models.forEach((m) => commandList.push({ id: `model-${m.claudeCodeId}`, label: `切换模型 · ${m.displayName}`, hint: g.label, group: "模型", run: () => setSelectedModel(m.claudeCodeId) })));
  // 指令组
  QUICK_ACTIONS.forEach((q) => commandList.push({ id: `quick-${q.label}`, label: `指令 · ${q.label}`, hint: q.hint, group: "指令", run: () => applyQuickAction(q.value) }));
  // 跳转组：切换 Inspector 标签
  INSPECTOR_TABS.forEach((t) => commandList.push({ id: `tab-${t.id}`, label: `Inspector · ${t.label}`, hint: "切换右侧面板标签", group: "跳转", run: () => setInspectorTab(t.id) }));
  // 会话组：最近 5 条
  filteredSessions.slice(0, 5).forEach((s) => commandList.push({
    id: `switch-${s.id}`,
    label: `切换会话 · ${s.title}`,
    hint: formatRelativeTime(s.updatedAt),
    group: "会话",
    run: () => { setActiveSessionId(s.id); setSidebarDrawerOpen(false); },
  }));
  // 会话组：置顶/取消置顶当前
  if (activeSessionId) {
    const isPinned = pinnedSessions.includes(activeSessionId);
    commandList.push({
      id: `pin-${activeSessionId}`,
      label: isPinned ? "取消置顶当前会话" : "置顶当前会话",
      hint: isPinned ? "从置顶区移除" : "固定到顶部",
      group: "会话",
      run: () => togglePinSession(activeSessionId),
    });
  }
  // 回滚组
  checkpoints.forEach((cp) => commandList.push({ id: `rb-${cp.id}`, label: `回滚 · ${cp.label || "历史状态"}`, hint: formatRelativeTime(cp.createdAt), group: "回滚", run: () => rollbackTo(cp.id, cp.label) }));

  const commandQueryLower = commandQuery.trim().toLowerCase();
  const commandFiltered = commandQueryLower
    ? commandList.filter((c) => c.label.toLowerCase().includes(commandQueryLower) || (c.hint?.toLowerCase().includes(commandQueryLower)) || c.group.toLowerCase().includes(commandQueryLower))
    : commandList;
  // 渲染分组：保持 commandList 顺序，相邻同 group 合并
  const commandGroups: Array<{ group: string; items: CommandItem[] }> = [];
  for (const cmd of commandFiltered) {
    const last = commandGroups[commandGroups.length - 1];
    if (last && last.group === cmd.group) last.items.push(cmd);
    else commandGroups.push({ group: cmd.group, items: [cmd] });
  }
  // 全局索引：键盘导航需要按渲染顺序的位置
  const flatIndexById = new Map<string, number>();
  let flatCounter = 0;
  for (const grp of commandGroups) {
    for (const item of grp.items) {
      flatIndexById.set(item.id, flatCounter++);
    }
  }
  // 任务 4：平铺数组，用于键盘导航 index 计算；commandIndex 始终对齐 commandFlat
  const commandFlat: CommandItem[] = commandGroups.flatMap((g) => g.items);
  function handleCommandKey(e: KeyboardEvent) {
    if (e.key === "Escape") { setCommandOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCommandIndex((i) => Math.min(i + 1, commandFlat.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setCommandIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); const cmd = commandFlat[commandIndex]; if (cmd) { cmd.run(); setCommandOpen(false); } }
  }

  // 任务 5 会话置顶：单条会话渲染抽出来，供置顶组/普通组复用
  function renderSessionItem(session: StudioSession, isPinned: boolean) {
    const isPinnedSession = isPinned;
    return (
      <div
        key={session.id}
        className={`${styles.sessionItem} ${session.id === activeSessionId ? styles.sessionActive : ""} ${isPinnedSession ? styles.sessionPinned : ""}`}
      >
        {editingSessionId === session.id ? (
          <form
            className={styles.sessionRenameForm}
            onSubmit={(e) => { e.preventDefault(); if (renamingSessionId !== session.id) void renameSession(session.id, editingSessionTitle); }}
          >
            <input
              autoFocus
              value={editingSessionTitle}
              onChange={(e) => setEditingSessionTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditingSessionId(null); } }}
              onBlur={() => { if (renamingSessionId !== session.id) void renameSession(session.id, editingSessionTitle); }}
              aria-label="重命名会话"
              maxLength={80}
            />
          </form>
        ) : (
          <>
            <button type="button" className={styles.sessionSelect} onClick={() => { setActiveSessionId(session.id); setSidebarDrawerOpen(false); }}>
              {isPinnedSession && <Pin size={11} className={styles.sessionPinIcon} aria-label="已置顶" />}
              <span className={styles.sessionTitle}>
                {session.title}
                {session.id === runningSessionId && <i className={styles.sessionRunning} title="后台运行中" />}
              </span>
              <em>{formatRelativeTime(session.updatedAt)}</em>
            </button>
            <button
              type="button"
              className={`${styles.sessionPin} ${isPinnedSession ? styles.sessionPinActive : ""}`}
              aria-label={isPinnedSession ? `取消置顶 ${session.title}` : `置顶 ${session.title}`}
              title={isPinnedSession ? "取消置顶" : "置顶"}
              onClick={() => togglePinSession(session.id)}
              disabled={savingStudioItem}
            >
              <Pin size={13} />
            </button>
            <button
              type="button"
              className={styles.sessionRename}
              aria-label={`重命名会话 ${session.title}`}
              title="重命名会话"
              onClick={() => { setEditingSessionId(session.id); setEditingSessionTitle(session.title); }}
              disabled={savingStudioItem}
            >
              <Pencil size={13} />
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
          </>
        )}
      </div>
    );
  }

  return (
    <main className={`${styles.page} ${theme === "light" ? styles.themeLight : ""}`}>
      <section className={styles.shell} aria-label="Sparkloom Studio">
        <nav className={styles.activityRail} aria-label="工作区工具栏">
          <Link href="/dashboard" className={styles.railBrand} title={BRAND_NAME} aria-label={BRAND_NAME}>
            <Image src="/logo.png" alt="" width={26} height={26} />
          </Link>
          {/* P2-4 平板/窄屏：hamburger 按钮展开 sidebar 抽屉（桌面端隐藏，由 CSS 控制） */}
          <button
            type="button"
            className={styles.sidebarDrawerToggle}
            title="展开会话列表"
            aria-label="展开会话列表"
            onClick={() => setSidebarDrawerOpen(true)}
          >
            <Menu size={18} />
          </button>
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
          <button
            type="button"
            title="重新启动新手引导"
            aria-label="重新启动新手引导"
            onClick={() => setShowOnboarding(true)}
          >
            <Sparkles size={18} />
          </button>
        </nav>

        {/* P2-4 sidebar：data-collapsed 控制桌面端 icon-only 折叠；data-drawer 控制平板抽屉显示 */}
        {/* 抽屉遮罩：仅 sidebarDrawerOpen 且窄屏时显示（CSS 控制 max-width 触发） */}
        {sidebarDrawerOpen && (
          <div
            className={styles.sidebarDrawerOverlay}
            onClick={() => setSidebarDrawerOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={styles.sidebar}
          data-collapsed={sidebarCollapsed ? "true" : undefined}
          data-drawer-open={sidebarDrawerOpen ? "true" : undefined}
        >
          <div className={styles.brandRow}>
            <div className={styles.workspaceLabel}>
              <span>工作区</span>
              <strong>{BRAND_NAME}</strong>
            </div>
            {/* P2-4 桌面端折叠按钮（窄屏由 CSS 隐藏） */}
            <button
              type="button"
              className={styles.sidebarCollapseBtn}
              onClick={() => setSidebarCollapsed((v) => {
                const next = !v;
                if (typeof window !== "undefined") {
                  try { window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next)); } catch {}
                }
                return next;
              })}
              title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
              aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
            >
              {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
            <Link href="/download" className={styles.iconButton} title="下载安装 Agent" aria-label="下载安装 Agent">
              <Download size={17} />
            </Link>
          </div>

          <button className={styles.newTaskButton} type="button" onClick={createSession} disabled={savingStudioItem}>
            <Plus size={16} />
            新建任务
          </button>

          <ImportSessionButton
            disabled={savingStudioItem}
            defaultModel={selectedModel}
            projectPath={projectPath}
            collapsed={sidebarCollapsed}
            inputRef={importInputRef}
            onImported={(session, messageCount) => {
              setSessions((current) => {
                // 去重：同一 id 不重复插入
                if (current.some((s) => s.id === session.id)) return current;
                return [session, ...current];
              });
              setActiveSessionId(session.id);
              setSidebarDrawerOpen(false);
              // 清空当前消息视图，触发该 session 的消息重新加载
              setMessages([]);
              setAgentActionMessage(`已导入会话「${session.title}」（${messageCount} 条消息，仅历史回看）`);
              // 重要提示：导入的会话没有 claudeSessionId，新发消息会开新 AI 会话，需清映射
              if (session.id) { claudeSessionRef.current.delete(session.id); persistClaudeSessionMap(); }
            }}
            onError={(msg) => setError(msg)}
          />

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
            <span className={styles.sectionTitle}>
              Sessions
              {sessionsTotal > filteredSessions.length && !searchMode ? <em>+{sessionsTotal - filteredSessions.length}</em> : null}
              {searchMode && <em>搜索结果</em>}
            </span>
            <div className={styles.sessionList} ref={sessionListRef}>
              {sessions.length === 0 ? (
                <button className={styles.emptySession} type="button" onClick={createSession}>
                  <MessageSquare size={16} />
                  {sessionSearch.trim() ? "没有匹配会话" : "创建第一个任务"}
                </button>
              ) : filteredSessions.length === 0 ? (
                <button className={styles.emptySession} type="button" onClick={() => setSessionSearch("")}>
                  <Search size={16} />
                  没有匹配会话
                </button>
              ) : (
                <>
                  {/* 任务 5 会话置顶：置顶区在顶部，普通区按 updatedAt */}
                  {pinnedSessionList.length > 0 && (
                    <div className={styles.sessionGroup} data-scope="pinned">
                      <span className={styles.sessionGroupTitle}><Pin size={11} /> 置顶</span>
                      {pinnedSessionList.map((session) => renderSessionItem(session, true))}
                    </div>
                  )}
                  {normalSessionList.length > 0 && (
                    <div className={styles.sessionGroup} data-scope="normal">
                      {pinnedSessionList.length > 0 && <span className={styles.sessionGroupTitle}>其他</span>}
                      {normalSessionList.map((session) => renderSessionItem(session, false))}
                    </div>
                  )}
                </>
              )}
              {!searchMode && sessions.length < sessionsTotal && (
                <div ref={loadMoreSentinelRef} className={styles.sessionLoadMore}>
                  {sessionsLoadingMore ? "加载中…" : "向下滚动加载更多"}
                </div>
              )}
              {searchMode && sessions.length > 0 && (
                <button type="button" className={styles.sessionLoadMore} onClick={() => setSessionSearch("")}>
                  清除搜索（显示全部会话）
                </button>
              )}
            </div>
          </div>

          <div className={styles.sidebarFooter}>
            <div className={styles.miniStat}>
              <Gauge size={15} />
              <span>{formatCurrency(data.quota.remaining)} 剩余</span>
            </div>
            <div
              className={`${styles.agentDot} ${agentReachable ? styles.agentOnline : styles.agentOffline}`}
              title={agentStatus.state === "online" ? `Agent v${agentStatus.version}（HTTP 健康）` : agentStatus.state === "unpaired" ? "需配对" : "未连接"}
            />
            {(agentRunning || wsStatus === "reconnecting") && (
              <div
                className={`${styles.wsDot} ${
                  wsStatus === "connected" ? styles.wsConnected :
                  wsStatus === "connecting" ? styles.wsConnecting :
                  wsStatus === "reconnecting" ? styles.wsReconnecting :
                  styles.wsDisconnected
                }`}
                title={
                  wsStatus === "connected" ? "WebSocket 已连接" :
                  wsStatus === "connecting" ? "WebSocket 连接中" :
                  wsStatus === "reconnecting" ? `WebSocket 重连中（第 ${wsReconnectAttempt}/5 次）` :
                  "WebSocket 未连接"
                }
              />
            )}
            <span>
              {agentStatus.state === "online" ? `Agent ${agentStatus.version}` : agentStatus.state === "unpaired" ? "需配对" : "未连接"}
              {wsStatus === "reconnecting" && ` · 重连 ${wsReconnectAttempt}/5`}
            </span>
          </div>
        </aside>

        <section className={styles.workspace}>
          <header className={styles.chromeBar}>
            <div className={styles.contextTitle}>
              <strong>{activeSession?.title || "未命名任务"}</strong>
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
                    className={`${executionMode === mode.id ? styles.modeActive : ""} ${mode.danger ? styles.modeDanger : ""} ${executionMode === mode.id && mode.danger ? styles.modeDangerActive : ""}`}
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
              <div className={styles.exportMenuWrap} ref={exportMenuRef}>
                <button
                  type="button"
                  className={styles.toolbarButton}
                  onClick={() => setExportMenuOpen((v) => !v)}
                  disabled={!activeSessionId}
                  title="导出会话"
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                >
                  <Download size={15} />
                  导出
                </button>
                {exportMenuOpen && activeSessionId && (
                  <div className={styles.exportMenu} data-popover role="menu">
                    <button type="button" role="menuitem" onClick={() => triggerExport("md")}>
                      <FileText size={14} />
                      <span>Markdown (.md)</span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => triggerExport("json")}>
                      <Boxes size={14} />
                      <span>JSON (.json)</span>
                    </button>
                  </div>
                )}
              </div>
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
          {notice && !error && (
            <div className={styles.inlineNotice} role="status">
              <Check size={15} />
              <span>{notice}</span>
            </div>
          )}
          {/* P2-5 消息级撤回：5 秒窗口内的最后一条 user 消息可撤回 */}
          {lastSentForUndo && !error && (
            <div className={styles.inlineNotice} role="status">
              <Check size={15} />
              <span>已发送</span>
              <button type="button" className={styles.undoButton} onClick={() => { void undoLastSend(); }}>撤回</button>
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
                <>
                  {todoList.length > 0 && (
                    <TodoListPanel todos={todoList} />
                  )}
                  {hiddenOlderCount > 0 && (
                    <div ref={topSentinelRef} className={styles.loadMoreSentinel}>
                      <button
                        type="button"
                        className={styles.loadMoreBtn}
                        onClick={() => {
                          const root = streamRef.current;
                          const prevHeight = root ? root.scrollHeight : 0;
                          prevScrollHeightRef.current = prevHeight;
                          isPrependingRef.current = true;
                          setVisibleCount((c) => c + MESSAGE_RENDER_GROW);
                        }}
                      >
                        加载更早的 {Math.min(MESSAGE_RENDER_GROW, hiddenOlderCount)} 条 · 还有 {hiddenOlderCount} 条历史
                      </button>
                    </div>
                  )}
                  {visibleMessages.map((message) => {
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
                    const cacheTotal = (u.cacheRead ?? 0) + (u.cacheCreation ?? 0) + (u.inputTokens ?? 0);
                    const cacheHit = cacheTotal > 0 ? Math.round(((u.cacheRead ?? 0) / cacheTotal) * 100) : null;
                    return (
                      <div key={message.id} className={styles.resultLine}>
                        <CheckCircle2 size={13} />
                        <span>完成 · 输入 {(u.inputTokens ?? 0).toLocaleString()} · 输出 {(u.outputTokens ?? 0).toLocaleString()}</span>
                        {cacheHit !== null && <span>· 缓存命中 {cacheHit}%</span>}
                        {message.changedFiles ? <span>· 改动 {message.changedFiles} 个文件</span> : null}
                        <strong>¥{(u.costUsd ?? 0).toFixed(4)}</strong>
                        {message.durationMs ? <em>{(message.durationMs / 1000).toFixed(1)}s{message.numTurns ? ` · ${message.numTurns} 轮` : ""}</em> : null}
                      </div>
                    );
                  }
                  if (message.kind === "tool") {
                    const isPending = Boolean(message.approvalId) && message.toolState === "running";
                    // 任务 4 子 agent 输出折叠：Task / Agent 工具默认折叠（即使 pending 也不自动展开）
                    const isSubAgentTool = /^(Task|Agent)$/i.test(String(message.toolName || ""));
                    const expanded = isSubAgentTool
                      ? expandedTools.has(message.id)
                      : (isPending || expandedTools.has(message.id));
                    const stateLabel = message.toolState === "done" ? "已完成" : message.toolState === "error" ? "失败" : isPending ? "待确认" : "进行中";
                    const isEditLike = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(message.toolName || ""));
                    const editInfo = isEditLike ? parseEditInput(message.toolInput) : null;
                    const summarySrc = editInfo?.filePath || message.toolInput || message.result || "";
                    const summary = summarySrc.split("\n")[0].replace(/^\s+/, "").slice(0, 70);
                    // 子 agent 卡片标题：取 toolInput 第一段做 description（通常是 subagent_type/description/prompt 字段）
                    const subAgentDescription = isSubAgentTool
                      ? (String(message.toolInput || "").split("\n")[0].replace(/^\s+["']?/, "").replace(/["']?\s*$/, "").slice(0, 80) || "子任务")
                      : "";
                    return (
                      <div key={message.id} className={`${styles.toolCard} ${isSubAgentTool ? styles.toolCardSubAgent : ""} ${isPending ? styles.toolPending : ""} ${message.risk ? styles[`risk_${message.risk}` as "risk_safe" | "risk_warn" | "risk_danger"] : ""}`}>
                        <div className={styles.toolHead} onClick={() => { if (!isPending) toggleToolExpand(message.id); }} style={{ cursor: isPending ? "default" : "pointer" }}>
                          <span className={styles.toolIcon}>{isSubAgentTool ? <Bot size={13} /> : <Wrench size={13} />}</span>
                          {isSubAgentTool ? (
                            <>
                              <strong>🤖 子任务: <span className={styles.toolSubAgentDesc}>{subAgentDescription}</span></strong>
                              {!expanded && <span className={styles.toolSummary}>点击展开查看子任务执行</span>}
                            </>
                          ) : (
                            <>
                              <strong>{message.toolName}</strong>
                              {!expanded && summary && <span className={styles.toolSummary}>{summary}</span>}
                            </>
                          )}
                          <em>{stateLabel}{!isPending && <span className={styles.toolChevron}>{expanded ? "▾" : "▸"}</span>}</em>
                        </div>
                        {expanded && (
                          <>
                            {message.humanHint && <p className={styles.toolHint}>{message.humanHint}</p>}
                            {editInfo ? (
                              <DiffBlock
                                filePath={editInfo.filePath}
                                oldText={editInfo.oldText}
                                newText={editInfo.newText}
                                applyContext={diffApplyContext}
                              />
                            ) : (
                              message.toolInput && <pre className={styles.toolInput}>{message.toolInput}</pre>
                            )}
                            {message.result && (
                              <ToolResultOutput message={message} expanded={expandedToolResults.has(message.id)} onToggle={() => setExpandedToolResults((prev) => {
                                const next = new Set(prev);
                                if (next.has(message.id)) next.delete(message.id); else next.add(message.id);
                                return next;
                              })} />
                            )}
                            {isPending && (
                              <div className={styles.approvalActions}>
                                <button type="button" className={styles.approvalDeny} disabled={respondingApprovalId === message.approvalId} onClick={() => respondApproval(message.approvalId!, "deny")}>拒绝 <kbd>N</kbd></button>
                                <button type="button" className={`${styles.approvalAllow} ${message.risk === "danger" ? styles.approvalDangerBg : ""}`} disabled={respondingApprovalId === message.approvalId} onClick={() => respondApproval(message.approvalId!, "allow")}>{respondingApprovalId === message.approvalId ? <Loader2 size={13} className={styles.spin} /> : null}批准 <kbd>Y</kbd></button>
                                {message.risk !== "danger" && !autoAcceptSession && (
                                  <button type="button" className={styles.approvalAuto} disabled={respondingApprovalId === message.approvalId} onClick={() => enableAutoAccept()} title="本次会话后续工具调用自动放行（危险操作仍会确认）">全部允许本次</button>
                                )}
                                {autoAcceptSession && message.risk !== "danger" && (
                                  <span className={styles.approvalAutoOn}>已开启自动放行</span>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }
                  const isUser = message.role === "user";
                  return (
                    <ChatTextMessage
                      key={message.id}
                      message={message}
                      userInitial={data.user.name.slice(0, 1)}
                      userName={data.user.name}
                      agentRunning={agentRunning}
                      onEdit={startEditMessage}
                      onFork={forkMessage}
                    />
                  );
                })
                }
                </>
              )}
            </div>

            {sessionContextInfo.total > 0 && (
              <div className={styles.contextMeter} title="「当前窗口」基于最近一次 result 的 prompt 大小（input+cacheRead+cacheCreation）估算；「会话累计」是历次 result 的 inputTokens 累加，仅供参考">
                <span className={styles.contextMeterLabel}><Gauge size={12} /> 上下文</span>
                <span className={styles.contextMeterTrack}>
                  <span
                    className={`${styles.contextMeterFill} ${sessionContextInfo.level === "ok" ? styles.contextMeterFillOk : sessionContextInfo.level === "warn" ? styles.contextMeterFillWarn : styles.contextMeterFillDanger}`}
                    style={{ width: `${Math.max(2, Math.round(sessionContextInfo.ratio * 100))}%` }}
                  />
                </span>
                <span className={styles.contextMeterHint}>
                  当前窗口 {sessionContextInfo.lastPromptTokens.toLocaleString()} / {CONTEXT_WINDOW_TOKENS.toLocaleString()}（{Math.round(sessionContextInfo.ratio * 100)}%）· 累计输入 {sessionContextInfo.total.toLocaleString()}
                </span>
                {sessionContextInfo.cacheRead > 0 && (
                  <span className={styles.contextMeterCache} title="prompt cache 命中率 = cache_read / (input + cache_read + cache_creation)">
                    缓存命中 {sessionContextInfo.hitRate}%
                  </span>
                )}
                {/* 当前窗口占用 >= 80% 时建议压缩（基于最近一次 result 的真实 prompt 大小，避免累计口径误触发） */}
                {sessionContextInfo.ratio >= 0.8 && !agentRunning && (
                  <button
                    type="button"
                    className={styles.contextCompactBtn}
                    onClick={() => void sendMessage("/compact")}
                    title="当前窗口占用 80% 以上，建议压缩或重置"
                  >
                    <Sparkles size={12} /> 上下文已满，点此压缩
                  </button>
                )}
              </div>
            )}

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
                {attachments.map((file) => {
                  const isImage = /^image\//i.test(file.type || "");
                  return (
                    <span key={file.id}>
                      {isImage && file.objectUrl ? (
                        <img src={file.objectUrl} alt={file.name} className={styles.attachmentThumb} />
                      ) : (
                        <FileText size={14} />
                      )}
                      {file.name}
                      <button
                        type="button"
                        aria-label={`移除 ${file.name}`}
                        onClick={() => {
                          if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
                          setAttachments((current) => current.filter((item) => item.id !== file.id));
                        }}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {agentRunning && agentActionMessage && (
              <div className={styles.composerStatus}><Loader2 size={13} className={styles.spin} /> {agentActionMessage}</div>
            )}
            {wsStatus === "reconnecting" && !agentRunning && (
              <div className={styles.composerStatus}>
                <Loader2 size={13} className={styles.spin} />
                Agent 重连中…第 {wsReconnectAttempt}/5 次
              </div>
            )}
            {wsStatus === "reconnecting" && agentRunning && (
              <div className={styles.composerStatus}>
                <Loader2 size={13} className={styles.spin} />
                Agent 重连中…第 {wsReconnectAttempt}/5 次（{agentActionMessage}）
              </div>
            )}
            <div
              className={styles.composer}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add(styles.composerDrag); }}
              onDragLeave={(e) => { e.currentTarget.classList.remove(styles.composerDrag); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove(styles.composerDrag);
                const dropped = Array.from(e.dataTransfer?.files || []);
                if (dropped.length > 0) addFilesAsAttachments(dropped);
              }}
            >
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
              {/* 任务 2 提示库入口：点击打开抽屉 */}
              <button
                type="button"
                className={styles.roundButton}
                onClick={() => setPromptLibraryOpen(true)}
                title="提示库（常用 prompt 模板）"
                aria-label="提示库"
              >
                <Library size={17} />
              </button>
              {slashMenuOpen && (
                <div className={styles.slashMenu} data-popover>
                  {slashFiltered.map((cmd, i) => (
                    <button
                      key={cmd.cmd}
                      type="button"
                      className={i === slashIndex ? styles.commandActive : styles.slashItem}
                      onClick={() => pickSlashCommand(cmd)}
                      onMouseEnter={() => setSlashIndex(i)}
                    >
                      <strong>{cmd.cmd}</strong>
                      <span>{cmd.desc}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={(e) => {
                  const items = Array.from(e.clipboardData?.items || []);
                  const files = items
                    .filter((it) => it.kind === "file")
                    .map((it) => it.getAsFile())
                    .filter((f): f is File => Boolean(f));
                  if (files.length > 0) {
                    e.preventDefault();
                    addFilesAsAttachments(files);
                  }
                }}
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
                className={`${styles.sendButton} ${agentRunning ? styles.sendButtonStop : ""}`}
                onClick={agentRunning ? cancelAgentRun : () => sendMessage()}
                disabled={!agentRunning && (savingStudioItem || (!prompt.trim() && attachments.length === 0))}
                aria-label={agentRunning ? "停止生成（Esc）" : "发送任务"}
                title={agentRunning ? "停止生成（Esc 也可中断）" : "发送任务（Enter）"}
              >
                {agentRunning ? <Square size={15} /> : <Play size={17} />}
              </button>
            </div>
            <div className={styles.composerHint}>Enter 发送 · Shift+Enter 换行 · Esc 中断 · Y/N 审批 · ⌘K 命令面板</div>
            {voiceState === "unsupported" && <div className={styles.composerHint}>当前浏览器不支持 Web Speech API，可以继续使用键盘输入。</div>}
          </div>

        </section>

        <aside className={styles.inspector} aria-label="Inspector 面板">
          <div className={styles.inspectorTabs} role="tablist">
            {INSPECTOR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={inspectorTab === tab.id}
                className={`${styles.inspectorTabBtn} ${inspectorTab === tab.id ? styles.inspectorTabActive : ""}`}
                onClick={() => setInspectorTab(tab.id)}
              >
                <tab.icon size={14} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className={styles.inspectorBody}>
            {inspectorTab === "model" && (
              <div className={styles.inspectorSection}>
                <PanelTitle icon={SlidersHorizontal} title="模型与配额" />
                <PermissionRow icon={Cpu} label="当前模型" value={selectedModelInfo?.displayName || selectedModel || "未选择"} />
                <PermissionRow icon={Gauge} label="配额剩余" value={formatCurrency(data.quota.remaining)} />
                <div className={`${styles.quotaPill} ${quotaClass}`}>{quotaStatusLabel(data.quota.status)}</div>
                {newKey && (
                  <ConfigBlock title="本机环境变量" value={configText} copied={copied} onCopy={copyText} />
                )}
              </div>
            )}

            {inspectorTab === "permissions" && (
              <div className={styles.inspectorSection}>
                <PanelTitle icon={ShieldCheck} title="本机 Agent 状态" />
                <PermissionRow icon={HardDrive} label="Agent 状态" value={agentStatus.state === "online" ? `在线 v${agentStatus.version}` : agentStatus.state === "unpaired" ? "需配对" : "未连接"} />
                <PermissionRow icon={Cpu} label="Claude SDK" value={agentStatus.state === "online" && agentStatus.claude ? (agentStatus.claude.configured ? "已配置" : "未配置") : "—"} />
                <PermissionRow icon={FolderInput} label="项目目录" value={projectPath.trim() || "未选择"} />
                <PermissionRow icon={ShieldCheck} label="执行模式" value={executionModeTitle(executionMode)} />
                {autoAcceptSession && (
                  <div className={styles.autoAcceptBadge}>已开启"全部允许本次"（危险操作仍确认）</div>
                )}

                <PanelTitle icon={Bell} title="任务完成通知" />
                {!notifySettings.supported ? (
                  <div className={styles.inspectorEmpty}>当前浏览器不支持桌面通知</div>
                ) : (
                  <>
                    <PermissionRow
                      icon={Bell}
                      label="浏览器权限"
                      value={notifySettings.permission === "granted" ? "已允许" : notifySettings.permission === "denied" ? "已拒绝（请在浏览器站点设置里改）" : "未申请"}
                    />
                    <div className={styles.notifyToggleRow}>
                      <label className={styles.notifySwitch}>
                        <input
                          type="checkbox"
                          checked={notifySettings.enabled}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setNotifyEnabled(enabled);
                            setNotifySettings(readNotifySettings());
                            // 开启时若未授权，主动申请
                            if (enabled && Notification.permission === "default") {
                              void requestNotifyPermission().then(() => setNotifySettings(readNotifySettings()));
                            }
                          }}
                        />
                        <span>启用任务完成提醒</span>
                      </label>
                      {notifySettings.permission !== "granted" && notifySettings.permission !== "denied" && (
                        <button
                          type="button"
                          className={styles.notifyActionButton}
                          onClick={() => {
                            void requestNotifyPermission().then((perm) => {
                              setNotifySettings(readNotifySettings());
                              setAgentActionMessage(perm === "granted" ? "通知权限已允许" : perm === "denied" ? "已拒绝通知权限" : "权限未决");
                            });
                          }}
                        >
                          申请权限
                        </button>
                      )}
                      {notifySettings.permission === "granted" && (
                        <button
                          type="button"
                          className={styles.notifyActionButton}
                          onClick={() => {
                            try {
                              const n = new Notification("Sparkloom Studio", {
                                body: "这是一条测试通知。任务完成时会自动提醒你。",
                                tag: "sparkloom-test",
                              });
                              window.setTimeout(() => { try { n.close(); } catch { /* ignore */ } }, 4000);
                              setAgentActionMessage("已发送测试通知");
                            } catch {
                              setAgentActionMessage("测试通知发送失败");
                            }
                          }}
                        >
                          测试通知
                        </button>
                      )}
                    </div>
                    <p className={styles.notifyHint}>
                      仅在页面不在前台、或任务时长超过 30 秒时提醒。点击通知切回该会话。
                    </p>
                  </>
                )}
              </div>
            )}

            {inspectorTab === "files" && (
              <div className={styles.inspectorSection}>
                <PanelTitle icon={FolderOpen} title="附件" />
                {attachments.length === 0 ? (
                  <div className={styles.inspectorEmpty}>暂无附件，可在 composer 拖拽 / 粘贴 / 点击 📎 添加</div>
                ) : (
                  <div className={styles.attachmentList}>
                    {attachments.map((file) => {
                      const isImage = /^image\//i.test(file.type || "");
                      return (
                        <div key={file.id} className={styles.attachmentItem}>
                          {isImage && file.objectUrl ? (
                            <img src={file.objectUrl} alt={file.name} className={styles.attachmentThumbLarge} />
                          ) : (
                            <FileText size={14} />
                          )}
                          <div className={styles.attachmentMeta}>
                            <strong>{file.name}</strong>
                            <em>{formatFileSize(file.size)}{isImage ? " · 图片" : ""}</em>
                          </div>
                          <button
                            type="button"
                            aria-label={`移除 ${file.name}`}
                            onClick={() => {
                              if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
                              setAttachments((current) => current.filter((item) => item.id !== file.id));
                            }}
                          >
                            <X size={13} />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
                {agentStatus.state === "online" && agentStatus.environment && (
                  <>
                    <PanelTitle icon={Terminal} title="环境检查" />
                    {agentStatus.environment.checks.length === 0 ? (
                      <div className={styles.inspectorEmpty}>无环境检查项</div>
                    ) : (
                      <ul className={styles.envCheckList}>
                        {agentStatus.environment.checks.map((chk) => (
                          <li key={chk.name} className={chk.ok ? styles.envCheckOk : styles.envCheckFail}>
                            <div className={styles.envCheckHead}>
                              {chk.ok ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
                              <strong>{chk.name}</strong>
                              {chk.version && <em>{chk.version}</em>}
                            </div>
                            {chk.error && <p className={styles.envCheckError}>{chk.error}</p>}
                            {!chk.ok && (() => {
                              const hint = agentStatus.environment?.installHints?.find((h) => h.name.toLowerCase() === chk.name.toLowerCase());
                              return hint ? (
                                <button
                                  type="button"
                                  className={styles.envInstallCopy}
                                  onClick={() => void copyText(`安装 ${chk.name}`, hint.command)}
                                  title={hint.command}
                                >
                                  复制安装命令 <Copy size={11} />
                                </button>
                              ) : null;
                            })()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            {inspectorTab === "skills" && (
              <SkillsPanel
                installed={agentStatus.state === "online" && agentStatus.skills ? agentStatus.skills.installed : []}
                missing={agentStatus.state === "online" && agentStatus.skills ? agentStatus.skills.missing : []}
                onUseSkill={(trigger) => {
                  setInspectorTab("model");
                  setPrompt(trigger);
                }}
                onInstall={async () => {
                  const baseUrl = agentBaseUrl();
                  if (!baseUrl) throw new Error("Agent 未连接");
                  const resp = await fetch(`${baseUrl}/skills/install`, {
                    method: "POST",
                    headers: agentAuthHeaders({ "x-sparkloom-local-confirm": "install-reviewed-skills" }),
                  });
                  if (!resp.ok) {
                    const txt = await resp.text().catch(() => "");
                    throw new Error(`安装失败：${resp.status} ${txt.slice(0, 200)}`);
                  }
                  // 安装完成后刷新 agent 状态
                  void checkAgent();
                }}
                onError={(msg) => setError(msg)}
              />
            )}

            {inspectorTab === "mcp" && (
              <McpPanel
                agentBase={agentBaseUrl()}
                agentAuthHeaders={agentAuthHeaders}
                onError={(msg) => setError(msg)}
                onNotice={(msg) => showNotice(msg)}
              />
            )}

            {inspectorTab === "cost" && (
              <CostPanel
                records={usageRecords}
                onClear={() => {
                  clearUsageRecords();
                  setUsageVersion((v) => v + 1);
                  showNotice("已清除本地用量统计");
                }}
              />
            )}

            {inspectorTab === "memory" && (
              <MemoryPanel
                agentBase={agentBaseUrl()}
                agentAuthHeaders={agentAuthHeaders}
                projectPath={projectPath.trim()}
                onError={(msg) => setError(msg)}
                onNotice={(msg) => showNotice(msg)}
              />
            )}

            {inspectorTab === "hooks" && (
              <HooksPanel
                agentBase={agentBaseUrl()}
                agentAuthHeaders={agentAuthHeaders}
                onError={(msg) => setError(msg)}
                onNotice={(msg) => showNotice(msg)}
              />
            )}

            {inspectorTab === "templates" && (
              <TemplatesPanel
                agentBase={agentBaseUrl()}
                agentAuthHeaders={agentAuthHeaders}
                projectPath={projectPath.trim()}
                onError={(msg) => setError(msg)}
                onNotice={(msg) => showNotice(msg)}
                onConfirm={(message, onConfirm) => setConfirmDialog({ message, onConfirm })}
              />
            )}

            {inspectorTab === "agents" && (
              <AgentsPanel
                agentBase={agentBaseUrl()}
                agentAuthHeaders={agentAuthHeaders}
                projectPath={projectPath.trim()}
                onError={(msg) => setError(msg)}
                onNotice={(msg) => showNotice(msg)}
                onConfirm={(message, onConfirm) => setConfirmDialog({ message, onConfirm })}
              />
            )}
          </div>
        </aside>

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
                {commandGroups.map((grp) => (
                  <div key={grp.group} className={styles.commandGroup}>
                    <div className={styles.commandGroupLabel}>{grp.group}</div>
                    {grp.items.map((cmd) => {
                      const flatIdx = flatIndexById.get(cmd.id) ?? -1;
                      return (
                        <button
                          key={cmd.id}
                          type="button"
                          className={flatIdx === commandIndex ? styles.commandActive : styles.commandItem}
                          onClick={() => { cmd.run(); setCommandOpen(false); }}
                          onMouseEnter={() => setCommandIndex(flatIdx)}
                        >
                          <span>{cmd.label}</span>
                          {cmd.hint && <em>{cmd.hint}</em>}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {commandFlat.length === 0 && <div className={styles.commandEmpty}>无匹配命令</div>}
              </div>
            </div>
          </div>
        )}

      </section>

      <PromptLibrary
        open={promptLibraryOpen}
        onClose={() => setPromptLibraryOpen(false)}
        onInsert={(content) => {
          setPrompt((current) => {
            const trimmed = current.trim();
            return trimmed ? `${trimmed}\n\n${content}` : content;
          });
          // 任务 2 提示库：插入后让 composer 输入框聚焦，方便用户继续编辑或直接发送
          setTimeout(() => {
            const ta = document.querySelector<HTMLTextAreaElement>(`.${styles.composer} textarea`);
            ta?.focus();
          }, 0);
          showNotice("已插入到输入框");
        }}
      />

      {showOnboarding && (
        <OnboardingModal
          agentOnline={agentOnline}
          keyConfigured={agentConfigured}
          models={data?.models || []}
          fallbackDefaultModel={getOnboardedDefaultModel() || selectedModel}
          onPickModel={(modelId) => {
            // 用户在引导里选的默认模型：保存到 localStorage + 切换当前选中
            try { window.localStorage.setItem(ONBOARDED_DEFAULT_MODEL_KEY, modelId); } catch { /* ignore */ }
            if (modelId && modelId !== selectedModel) {
              setSelectedModel(modelId);
            }
          }}
          onClose={() => setShowOnboarding(false)}
        />
      )}

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

      {rollbackPreview && (
        <div className={styles.commandOverlay} onClick={() => { if (!rollbackPreview.loading) setRollbackPreview(null); }}>
          <div className={styles.rollbackDiffDialog} onClick={(e) => e.stopPropagation()} data-popover>
            <div className={styles.rollbackDiffHeader}>
              <RotateCcw size={20} />
              <strong>回滚到「{rollbackPreview.label || "历史状态"}」</strong>
            </div>
            <p className={styles.rollbackDiffHint}>
              这之后的文件改动会被撤销，对话记录保留。
            </p>

            {rollbackPreview.sensitiveHits.length > 0 && (
              <div className={styles.rollbackDiffSensitive}>
                <div className={styles.rollbackDiffSensitiveTitle}>⚠️ 警告：本次会话改动过以下敏感文件，回滚将一并还原：</div>
                <ul>
                  {rollbackPreview.sensitiveHits.slice(0, 8).map((f) => <li key={f}>{f}</li>)}
                  {rollbackPreview.sensitiveHits.length > 8 && <li>…等 {rollbackPreview.sensitiveHits.length} 个</li>}
                </ul>
              </div>
            )}

            {rollbackPreview.loading && (
              <div className={styles.rollbackDiffLoading}>正在分析文件差异…</div>
            )}
            {rollbackPreview.error && (
              <div className={styles.rollbackDiffError}>
                无法加载 diff：{rollbackPreview.error}
                <div className={styles.rollbackDiffErrorHint}>仍可基于敏感文件提示回滚，建议确认 Agent 在线后重试。</div>
              </div>
            )}
            {rollbackPreview.diff && (
              <div className={styles.rollbackDiffBody}>
                <div className={styles.rollbackDiffSummary}>
                  共 <strong>{rollbackPreview.diff.totalChanged}</strong> 个文件变化 ·
                  新增 {rollbackPreview.diff.addedTotal} · 修改 {rollbackPreview.diff.modifiedTotal} · 删除 {rollbackPreview.diff.deletedTotal}
                </div>
                {rollbackPreview.diff.totalChanged === 0 && (
                  <p className={styles.rollbackDiffEmpty}>无文件变化（当前目录已与快照一致）</p>
                )}
                {rollbackPreview.diff.modified.length > 0 && (
                  <div className={styles.rollbackDiffGroup}>
                    <div className={styles.rollbackDiffGroupTitle}>修改 · 回滚后会还原</div>
                    <ul className={styles.rollbackDiffList}>
                      {rollbackPreview.diff.modified.map((f) => <li key={f} className={styles.rollbackDiffItemModified}>{f}</li>)}
                    </ul>
                  </div>
                )}
                {rollbackPreview.diff.added.length > 0 && (
                  <div className={styles.rollbackDiffGroup}>
                    <div className={styles.rollbackDiffGroupTitle}>新增 · 回滚后会丢失</div>
                    <ul className={styles.rollbackDiffList}>
                      {rollbackPreview.diff.added.map((f) => <li key={f} className={styles.rollbackDiffItemAdded}>{f}</li>)}
                    </ul>
                  </div>
                )}
                {rollbackPreview.diff.deleted.length > 0 && (
                  <div className={styles.rollbackDiffGroup}>
                    <div className={styles.rollbackDiffGroupTitle}>删除 · 回滚后会恢复</div>
                    <ul className={styles.rollbackDiffList}>
                      {rollbackPreview.diff.deleted.map((f) => <li key={f} className={styles.rollbackDiffItemDeleted}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.approvalDeny}
                disabled={rollbackPreview.loading}
                onClick={() => setRollbackPreview(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.approvalAllow}
                disabled={rollbackPreview.loading || (!!rollbackPreview.error)}
                onClick={() => {
                  const cpId = rollbackPreview.cpId;
                  setRollbackPreview(null);
                  void doRollback(cpId);
                }}
              >
                确认回滚
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P2-2 /context 调试视图 modal */}
      {contextView && (
        <div className={styles.commandOverlay} onClick={() => { if (!contextView.loading) setContextView(null); }}>
          <div className={styles.contextModal} onClick={(e) => e.stopPropagation()}>
            <header className={styles.contextModalHead}>
              <strong>当前上下文</strong>
              <button type="button" className={styles.iconButton} onClick={() => setContextView(null)} aria-label="关闭">关闭</button>
            </header>
            <div className={styles.contextBody}>
              {contextView.loading && <div className={styles.contextLoading}>读取中…</div>}
              {contextView.error && <div className={styles.inlineError} role="alert">{contextView.error}</div>}
              {!contextView.loading && (
                <>
                  <section className={styles.contextSection}>
                    <h4>会话消息（{contextView.messages.length} 条）</h4>
                    <div className={styles.contextUsageBar}>
                      <div
                        className={`${styles.contextUsageFill} ${
                          contextView.totalTokens / contextView.contextWindow > 0.75 ? styles.contextUsageHigh :
                          contextView.totalTokens / contextView.contextWindow > 0.4 ? styles.contextUsageMid : styles.contextUsageLow
                        }`}
                        style={{ width: `${Math.min(100, (contextView.totalTokens / contextView.contextWindow) * 100)}%` }}
                      />
                    </div>
                    <p className={styles.contextHint}>
                      估算 {contextView.totalTokens.toLocaleString()} / {contextView.contextWindow.toLocaleString()} tokens（{(contextView.totalTokens / contextView.contextWindow * 100).toFixed(1)}%）
                      · 仅文本字符粗估，实际 SDK 计数可能不同
                    </p>
                    <ul className={styles.contextMsgList}>
                      {contextView.messages.slice(-30).map((m) => (
                        <li key={m.id} className={styles.contextMsgItem}>
                          <span className={styles.contextMsgRole}>{m.role === "user" ? "我" : "AI"}</span>
                          <span className={styles.contextMsgContent}>{m.content.slice(0, 120)}{m.content.length > 120 ? "…" : ""}</span>
                        </li>
                      ))}
                      {contextView.messages.length > 30 && <li className={styles.contextMore}>… 仅显示最后 30 条（共 {contextView.messages.length} 条）</li>}
                    </ul>
                  </section>
                  {contextView.agent && (
                    <>
                      <section className={styles.contextSection}>
                        <h4>System Prompt 来源</h4>
                        <ul className={styles.contextSourceList}>
                          {contextView.agent.systemPromptSources.map((s) => (
                            <li key={`${s.kind}-${s.path}`} className={styles.contextSourceItem}>
                              <span className={`${styles.contextSourceBadge} ${s.exists ? styles.contextSourceOk : styles.contextSourceOff}`}>
                                {s.exists ? "已加载" : "缺失"}
                              </span>
                              <span className={styles.contextSourceScope}>[{s.scope}]</span>
                              <code className={styles.contextSourcePath}>{s.path}</code>
                              {s.exists && s.size > 0 && <em>{(s.size / 1024).toFixed(1)} KB</em>}
                            </li>
                          ))}
                        </ul>
                      </section>
                      <section className={styles.contextSection}>
                        <h4>环境</h4>
                        <dl className={styles.contextEnvList}>
                          <dt>当前工作目录</dt><dd>{contextView.agent.cwd || "(未指定)"}</dd>
                          <dt>Claude Code 配置目录</dt><dd><code>{contextView.agent.configDir}</code></dd>
                          <dt>Gateway Base URL</dt><dd><code>{contextView.agent.gateway.baseUrl || "(未配置)"}</code></dd>
                          <dt>Gateway 模型</dt><dd>{contextView.agent.gateway.model || "(默认)"}</dd>
                          <dt>Agent 版本</dt><dd>v{contextView.agent.agentVersion}</dd>
                        </dl>
                        <p className={styles.contextNote}>{contextView.agent.note}</p>
                      </section>
                    </>
                  )}
                </>
              )}
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

// 行级 LCS diff：把 old/new 拆行做最长公共子序列，输出 unchanged/context/add/del 四类行
function computeLineDiff(oldText: string, newText: string): Array<{ kind: "ctx" | "add" | "del"; text: string }> {
  const a = (oldText || "").split("\n");
  const b = (newText || "").split("\n");
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度（尾部对齐，方便回溯）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ kind: "ctx" | "add" | "del"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "ctx", text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i += 1; }
    else { out.push({ kind: "add", text: b[j] }); j += 1; }
  }
  while (i < n) { out.push({ kind: "del", text: a[i] }); i += 1; }
  while (j < m) { out.push({ kind: "add", text: b[j] }); j += 1; }
  return out;
}

function extractTextFromReactNode(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromReactNode).join("");
  if (typeof node === "object" && "props" in (node as object)) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractTextFromReactNode(props?.children);
  }
  return "";
}

function langFromFilePath(filePath?: string): string {
  if (!filePath) return "";
  const ext = filePath.split(/[\\/]/).pop()?.split(".").pop();
  if (!ext) return "";
  return resolveLang(ext);
}

// 任务 1：把行级 diff 切成连续 hunk 段（每个 hunk = 一段连续的 add/del）
// 用于 DiffBlock 渲染逐块 [接受]/[拒绝] 按钮
type LineDiffEntry = { kind: "ctx" | "add" | "del"; text: string };
type DiffSegment =
  | { kind: "ctx"; lines: LineDiffEntry[] }
  | { kind: "hunk"; lines: LineDiffEntry[]; oldText: string; newText: string; hunkIdx: number; beforeCtxLine?: string; afterCtxLine?: string };

function splitIntoHunks(diff: LineDiffEntry[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let i = 0;
  let hunkIdx = 0;
  let ctxBuf: LineDiffEntry[] = [];
  while (i < diff.length) {
    if (diff[i].kind === "ctx") {
      ctxBuf.push(diff[i]);
      i += 1;
    } else {
      if (ctxBuf.length > 0) { segments.push({ kind: "ctx", lines: ctxBuf }); ctxBuf = []; }
      const oldLines: string[] = [];
      const newLines: string[] = [];
      const hunkLines: LineDiffEntry[] = [];
      while (i < diff.length && diff[i].kind !== "ctx") {
        hunkLines.push(diff[i]);
        if (diff[i].kind === "del") oldLines.push(diff[i].text);
        else newLines.push(diff[i].text);
        i += 1;
      }
      segments.push({ kind: "hunk", lines: hunkLines, oldText: oldLines.join("\n"), newText: newLines.join("\n"), hunkIdx });
      hunkIdx += 1;
    }
  }
  if (ctxBuf.length > 0) segments.push({ kind: "ctx", lines: ctxBuf });
  // H3: 为纯插入类 hunk 补上下文锚点（取相邻 ctx 段的边界行原文），供 apply-hunk 精确定位插入位置
  for (let k = 0; k < segments.length; k += 1) {
    const seg = segments[k];
    if (seg.kind !== "hunk") continue;
    const prev = segments[k - 1];
    const next = segments[k + 1];
    if (prev && prev.kind === "ctx" && prev.lines.length > 0) {
      seg.beforeCtxLine = prev.lines[prev.lines.length - 1].text;
    }
    if (next && next.kind === "ctx" && next.lines.length > 0) {
      seg.afterCtxLine = next.lines[0].text;
    }
  }
  return segments;
}

// H3: 判定一个 hunk 是否可被 apply-hunk 安全应用
// 替换类（有删除行 → oldText 非空）：永远可应用
// 纯插入类（oldText 空）：必须有"足够独特"的上下文锚点（trim 后 ≥6 字符，过滤空行/花括号/短分隔符）
// 不满足则前端禁用 [接受] 按钮，避免 agent 端 throw "纯插入缺少锚点"
function canApplyHunk(hunk: { oldText: string; beforeCtxLine?: string; afterCtxLine?: string }): boolean {
  if (hunk.oldText) return true;
  const beforeLine = (hunk.beforeCtxLine || "").trim();
  const afterLine = (hunk.afterCtxLine || "").trim();
  return beforeLine.length >= 6 || afterLine.length >= 6;
}

// 任务 1：DiffBlock 逐块 Apply 上下文。传入则启用 [接受]/[拒绝] 按钮
// filePath 由 DiffBlock 自身 prop 提供，applyContext 只负责 cwd + agent 调用
interface DiffApplyContext {
  cwd: string;
  agentBase: string | null;
  agentAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  onApplied: (checkpointId: string) => void;
  onError: (msg: string) => void;
}

function DiffBlock({
  filePath,
  oldText,
  newText,
  applyContext,
}: {
  filePath?: string;
  oldText?: string;
  newText?: string;
  applyContext?: DiffApplyContext | null;
}) {
  const diff = useMemo(() => computeLineDiff(oldText || "", newText || ""), [oldText, newText]);
  // 大 diff 折叠：>200 行只渲染前 200 行，避免一帧渲染太多 DOM 拖死页面
  const trimmed = diff.length > 200 ? diff.slice(0, 200) : diff;
  const truncated = diff.length - trimmed.length;
  const lang = useMemo(() => langFromFilePath(filePath), [filePath]);
  // Shiki 按行 token 化（add/del 行用对应语言着色，ctx 行用灰色不参与）
  const [lineTokens, setLineTokens] = useState<Record<string, ThemedToken[] | null>>({});
  const cacheKey = useMemo(() => trimmed.map((l) => l.text).join("\n"), [trimmed]);
  useEffect(() => {
    if (!lang) { setLineTokens({}); return; }
    let cancelled = false;
    const uniqueLines = Array.from(new Set(trimmed.map((l) => l.text).filter((t) => t.length > 0)));
    void Promise.all(uniqueLines.map((t) => tokenizeLine(t, lang))).then((results) => {
      if (cancelled) return;
      const map: Record<string, ThemedToken[] | null> = {};
      uniqueLines.forEach((t, i) => { map[t] = results[i]; });
      setLineTokens(map);
    });
    return () => { cancelled = true; };
  }, [cacheKey, lang]);

  // 任务 1：hunk 状态（pending/applied/rejected/applying/error）+ 全部接受
  const segments = useMemo(() => (applyContext ? splitIntoHunks(trimmed) : []), [trimmed, applyContext]);
  const [hunkStates, setHunkStates] = useState<Record<number, "pending" | "applying" | "applied" | "rejected" | "error">>({});
  // L1：applyAll 串行执行期间置 true，按钮 disable 防双击基于尚未更新的 hunkStates 重复发请求。
  // hunkStatesRef 让 applyOne 守卫读到最新状态（避免 useCallback 闭包 stale 读到旧值使守卫失效）。
  // applyAllRunningRef 是同步标志，比 state 更可靠地拦下"状态异步渲染前到达的第二次 click"。
  const [applyAllRunning, setApplyAllRunning] = useState(false);
  const applyAllRunningRef = useRef(false);
  const hunkStatesRef = useRef(hunkStates);
  hunkStatesRef.current = hunkStates;
  useEffect(() => { setHunkStates({}); }, [cacheKey, applyContext]);

  const applyOne = useCallback(async (hunk: { oldText: string; newText: string; hunkIdx: number; beforeCtxLine?: string; afterCtxLine?: string }) => {
    if (!applyContext || !applyContext.agentBase) {
      applyContext?.onError("本机 Agent 未连接，无法应用改动");
      return;
    }
    if (!filePath) {
      applyContext.onError("缺少文件路径，无法应用改动");
      return;
    }
    // L1：防御性——过期调用直接跳过。读 ref 拿最新状态：applyAll 串行期间 hunk 已被前一次 await 标成
    // applied/applying/error，或用户在 applyAll 运行中又点了单 hunk 接受，重复 POST 会被这里拦下。
    if ((hunkStatesRef.current[hunk.hunkIdx] || "pending") !== "pending") return;
    setHunkStates((cur) => ({ ...cur, [hunk.hunkIdx]: "applying" }));
    try {
      // H3: 构造 hunk payload。替换类（有 oldText）走原 oldText/newText 路径，agent 端唯一匹配替换
      // 纯插入类（oldText 空）必须带 beforeAnchor/afterAnchor，否则 agent 拒绝（防误追加到文件末尾）
      const hunkPayload: Record<string, string> = { oldText: hunk.oldText, newText: hunk.newText };
      if (!hunk.oldText) {
        const beforeLine = hunk.beforeCtxLine || "";
        const afterLine = hunk.afterCtxLine || "";
        if (beforeLine.trim().length >= 6) {
          // beforeAnchor 带 \n 后缀：agent 端 `beforeAnchor + newText` 形成 "前一行\n新内容"
          hunkPayload.beforeAnchor = beforeLine + "\n";
        } else if (afterLine.trim().length >= 6) {
          // afterAnchor 不带换行，newText 后补 \n：agent 端 `newText + afterAnchor` 形成 "新内容\n后一行"
          hunkPayload.afterAnchor = afterLine;
          hunkPayload.newText = hunk.newText + "\n";
        }
      }
      const res = await fetch(`${applyContext.agentBase}/claude/apply-hunk`, {
        method: "POST",
        headers: applyContext.agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "apply-hunk",
        }),
        body: JSON.stringify({
          filePath,
          cwd: applyContext.cwd,
          hunks: [hunkPayload],
        }),
      });
      const body = await res.json().catch(() => ({} as { error?: string; checkpointId?: string }));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setHunkStates((cur) => ({ ...cur, [hunk.hunkIdx]: "applied" }));
      if (body.checkpointId) applyContext.onApplied(body.checkpointId);
    } catch (err) {
      setHunkStates((cur) => ({ ...cur, [hunk.hunkIdx]: "error" }));
      applyContext.onError(err instanceof Error ? err.message : "应用失败");
    }
  }, [applyContext, filePath]);

  const rejectOne = useCallback((idx: number) => {
    setHunkStates((cur) => ({ ...cur, [idx]: "rejected" }));
  }, []);

  const applyAll = useCallback(async () => {
    // L1：applyAllRunningRef 双重防护（state 异步渲染前第二次 click 已在事件队列里，单靠 state disable 不够稳）
    if (applyAllRunningRef.current) return;
    const pending = segments.filter((s): s is Extract<DiffSegment, { kind: "hunk" }> => s.kind === "hunk")
      .filter((h) => (hunkStatesRef.current[h.hunkIdx] || "pending") === "pending" && canApplyHunk(h));
    if (pending.length === 0) return;
    applyAllRunningRef.current = true;
    setApplyAllRunning(true);
    try {
      for (const h of pending) {
        // 顺序应用：每个 hunk 独立 API 调用，避免一次失败影响其他
        // eslint-disable-next-line no-await-in-loop
        await applyOne(h);
      }
    } finally {
      applyAllRunningRef.current = false;
      setApplyAllRunning(false);
    }
  }, [segments, applyOne]);

  const totalHunks = segments.filter((s) => s.kind === "hunk").length;
  const pendingHunks = totalHunks === 0 ? 0 : segments.filter((s): s is Extract<DiffSegment, { kind: "hunk" }> => s.kind === "hunk")
    .filter((h) => (hunkStates[h.hunkIdx] || "pending") === "pending" && canApplyHunk(h)).length;

  return (
    <div className={styles.diffBlock}>
      {filePath && (
        <div className={styles.diffFile}><FilePen size={12} /> {filePath}</div>
      )}
      {applyContext && totalHunks > 0 && (
        <div className={styles.diffActionsBar}>
          <span className={styles.diffActionsHint}>
            共 {totalHunks} 个改动块，待处理 {pendingHunks}
          </span>
          <button
            type="button"
            className={styles.approvalAllow}
            disabled={pendingHunks === 0 || applyAllRunning}
            onClick={() => void applyAll()}
            title="把所有未处理改动块依次写入文件"
          >
            全部接受
          </button>
        </div>
      )}
      <pre className={styles.diffCode}>
        {applyContext && totalHunks > 0 ? (
          segments.map((seg, segIdx) => {
            if (seg.kind === "ctx") {
              return (
                <div key={`seg-${segIdx}`} className={styles.diffSegmentCtx}>
                  {seg.lines.map((line, idx) => {
                    const tokens = line.text ? lineTokens[line.text] : null;
                    return (
                      <div key={`c-${segIdx}-${idx}`} className={styles.diffCtxLine}>
                        <span className={styles.diffSign}> </span>
                        {tokens && tokens.length > 0
                          ? tokens.map((t, j) => (<span key={j} style={t.color ? { color: t.color } : undefined}>{t.content}</span>))
                          : (line.text || " ")}
                      </div>
                    );
                  })}
                </div>
              );
            }
            const state = hunkStates[seg.hunkIdx] || "pending";
            return (
              <div key={`seg-${segIdx}`} className={`${styles.diffSegmentHunk} ${styles[`hunkState_${state}`] || ""}`}>
                {seg.lines.map((line, idx) => {
                  const tokens = line.text ? lineTokens[line.text] : null;
                  const cls = line.kind === "add" ? styles.diffAddLine : styles.diffDelLine;
                  const sign = line.kind === "add" ? "+" : "-";
                  return (
                    <div key={`h-${segIdx}-${idx}`} className={cls}>
                      <span className={styles.diffSign}>{sign}</span>
                      {tokens && tokens.length > 0
                        ? tokens.map((t, j) => (<span key={j} style={t.color ? { color: t.color } : undefined}>{t.content}</span>))
                        : (line.text || " ")}
                    </div>
                  );
                })}
                {state === "pending" && (
                  <div className={styles.hunkActions}>
                    <button type="button" className={styles.approvalDeny} onClick={() => rejectOne(seg.hunkIdx)}>拒绝</button>
                    <button
                      type="button"
                      className={styles.approvalAllow}
                      disabled={!canApplyHunk(seg)}
                      title={!canApplyHunk(seg) ? "纯新增内容缺少定位锚点，建议让 Claude 用 Edit 工具重新定位" : undefined}
                      onClick={() => void applyOne(seg)}
                    >
                      接受
                    </button>
                  </div>
                )}
                {state === "applying" && (
                  <div className={styles.hunkBadge}><Loader2 size={12} className={styles.spin} /> 应用中…</div>
                )}
                {state === "applied" && (
                  <div className={styles.hunkBadgeApplied}><CheckCircle2 size={12} /> 已接受</div>
                )}
                {state === "rejected" && (
                  <div className={styles.hunkBadgeRejected}>已拒绝（保持原样）</div>
                )}
                {state === "error" && (
                  <div className={styles.hunkBadgeError}>
                    应用失败，可重试
                    <button type="button" className={styles.approvalAllow} onClick={() => void applyOne(seg)}>重试</button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          trimmed.map((line, idx) => {
            const tokens = line.text ? lineTokens[line.text] : null;
            const cls = line.kind === "add" ? styles.diffAddLine : line.kind === "del" ? styles.diffDelLine : styles.diffCtxLine;
            const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
            return (
              <div key={idx} className={cls}>
                <span className={styles.diffSign}>{sign}</span>
                {tokens && tokens.length > 0
                  ? tokens.map((t, j) => (<span key={j} style={t.color ? { color: t.color } : undefined}>{t.content}</span>))
                  : (line.text || " ")}
              </div>
            );
          })
        )}
        {truncated > 0 && <div className={styles.diffCtxLine}><span className={styles.diffSign}> </span>…（{truncated} 行已折叠）</div>}
      </pre>
    </div>
  );
}

const CODE_BLOCK_LINE_CAP = 500;
const PREVIEWABLE_LANGS = new Set(["html", "svg"]);

function CodeBlock(props: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // children 是 ReactMarkdown 透传的 <code className="language-xxx"> 元素；纯 pre 无 code 子节点时回退
  const child = Array.isArray(props.children) ? props.children[0] : props.children;
  const codeEl = (child ?? null) as React.ReactElement<{ className?: string; children?: ReactNode }> | null;
  const className = codeEl?.props?.className;
  const lang = useMemo(() => (className ? resolveLang(className) : ""), [className]);
  const rawCode = useMemo(() => {
    if (codeEl && codeEl.props) return extractTextFromReactNode(codeEl.props.children).replace(/\n$/, "");
    return extractTextFromReactNode(props.children).replace(/\n$/, "");
  }, [codeEl, props.children]);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    if (!lang || !rawCode) { setTokens(null); return; }
    let cancelled = false;
    void tokenizeCode(rawCode, lang).then((out) => {
      if (cancelled) return;
      setTokens(out);
    });
    return () => { cancelled = true; };
  }, [rawCode, lang]);
  const visibleLines = useMemo<ThemedToken[][] | null>(() => {
    if (!tokens) return null;
    if (tokens.length > CODE_BLOCK_LINE_CAP) return tokens.slice(0, CODE_BLOCK_LINE_CAP);
    return tokens;
  }, [tokens]);
  const truncatedLines = tokens ? Math.max(0, tokens.length - CODE_BLOCK_LINE_CAP) : 0;
  const canPreview = Boolean(lang) && PREVIEWABLE_LANGS.has(lang) && rawCode.length > 0;
  const copy = async () => {
    const text = ref.current?.textContent || rawCode;
    if (!text) return;
    // P2-a 复制失败 fallback：navigator.clipboard 不可用（非 HTTPS webview）时降级 execCommand
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // 仍然失败就静默
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={styles.codeBlock}>
      {lang && <span className={styles.codeLang}>{lang}</span>}
      <div className={styles.codeActions}>
        {canPreview && (
          <button
            type="button"
            className={styles.codePreviewToggle}
            onClick={() => setPreviewing((v) => !v)}
            aria-label={previewing ? "查看代码" : "预览渲染效果"}
            title={previewing ? "查看代码" : "预览渲染效果"}
          >
            <Eye size={13} />
            {previewing ? "代码" : "预览"}
          </button>
        )}
        <button type="button" className={styles.codeCopy} onClick={copy} aria-label="复制代码">
          {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
        </button>
      </div>
      {previewing && canPreview ? (
        <ArtifactPreview lang={lang} code={rawCode} />
      ) : (
      <pre ref={ref}>
        {visibleLines
          ? visibleLines.map((line, i) => (
              <div key={i} className={styles.codeLine}>
                {line.length === 0
                  ? " "
                  : line.map((t, j) => (<span key={j} style={t.color ? { color: t.color } : undefined}>{t.content}</span>))}
              </div>
            ))
          : (rawCode || props.children)}
        {truncatedLines > 0 && (
          <div className={styles.codeTrunc}>…（{truncatedLines} 行已折叠，复制仍为全文）</div>
        )}
      </pre>
      )}
    </div>
  );
}

// 任务 3 Artifact 预览：纯前端渲染 Claude 输出的 ```html / ```svg 代码块
// 安全：html 走 sandbox="" iframe（禁所有能力 + CSP 限制只能内联样式/data 图片），svg 走 data URL img（不执行脚本）
function ArtifactPreview({ lang, code }: { lang: string; code: string }) {
  const srcDoc = useMemo(() => {
    if (lang === "svg") return "";
    // CSP 限制：禁止脚本、外部连接、iframe 嵌套；只允许内联样式和 data/https 图片
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:;"></head><body>${code}</body></html>`;
  }, [lang, code]);
  if (lang === "svg") {
    // encodeURIComponent 兼容特殊字符；不直接 dangerouslySetInnerHTML 避免 XSS
    const url = `data:image/svg+xml;utf8,${encodeURIComponent(code)}`;
    return (
      <div className={styles.artifactPreview}>
        <img src={url} alt="SVG 预览" />
      </div>
    );
  }
  return (
    <div className={styles.artifactPreview}>
      <iframe
        // sandbox="" 全空：禁所有能力（脚本/form/popups/same-origin/top-navigation 等）
        sandbox=""
        srcDoc={srcDoc}
        title="HTML 预览"
      />
    </div>
  );
}

// I-1 性能：把纯文本/Markdown 消息抽出成 memo 子组件，避免父 state 变化导致全列表重渲
type ChatTextMessageProps = {
  message: StudioMessage;
  userInitial: string;
  userName: string;
  agentRunning: boolean;
  onEdit: (message: StudioMessage) => void;
  onFork?: (message: StudioMessage) => void;
};

// 任务 5：Markdown 增强渲染——
// - pre: 仍走 CodeBlock（Shiki 高亮 + 复制 + 预览）
// - a: 强制 target=_blank rel=noopener noreferrer，防 tabnabbing 与反向跳转
// - img: 加 loading="lazy"，限制 max-width 不撑破容器
// - table: 包一层 overflow-x 容器，宽表横向滚动
// - 其他元素样式（h1-h6/ul/ol/li/blockquote/th/td 等）交给 CSS `.markdown :global(...)` 统一处理
// 模块级常量，避免每次 render 新建对象触发 ReactMarkdown 重渲
const MARKDOWN_COMPONENTS = {
  pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href, ...rest }: { children?: ReactNode; href?: string; [key: string]: unknown }) => (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
  ),
  img: ({ src, alt, ...rest }: { src?: string; alt?: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...rest} src={src} alt={alt || ""} loading="lazy" />
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className={styles.mdTableWrap}><table>{children}</table></div>
  ),
} as const;


const ChatTextMessage = memo(function ChatTextMessage({
  message,
  userInitial,
  userName,
  agentRunning,
  onEdit,
  onFork,
}: ChatTextMessageProps) {
  const isUser = message.role === "user";
  // P1-a 消息级复制按钮：自管 copied 状态，不破 memo
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function copyMessage() {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      // P2-a 复制失败 fallback：非 HTTPS webview 等场景降级到 execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = message.content;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // 仍然失败就静默
      }
    }
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1600);
  }
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);
  return (
    <article className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
      <div className={styles.messageAvatar}>{isUser ? userInitial : <Bot size={16} />}</div>
      <div className={styles.messageBody}>
        <header>
          <strong>{isUser ? userName : "Sparkloom"}</strong>
          <span>{formatRelativeTime(message.createdAt)}</span>
          <button
            type="button"
            className={styles.messageCopyBtn}
            onClick={copyMessage}
            aria-label={copied ? "已复制" : "复制消息"}
            title={copied ? "已复制" : "复制消息"}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </header>
        {isUser ? (
          <div className={styles.userContent}>
            <p>{message.content}</p>
            {!agentRunning && (
              <button type="button" className={styles.editButton} onClick={() => onEdit(message)} title="编辑并从这里重新生成">
                <Pencil size={12} /> 编辑
              </button>
            )}
            {!agentRunning && onFork && (
              <button type="button" className={styles.editButton} onClick={() => onFork(message)} title="从此处分叉到新会话（保留原会话）">
                <GitBranch size={12} /> 分叉
              </button>
            )}
          </div>
        ) : (
          <div className={styles.markdown}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS as never}>{message.content || ""}</ReactMarkdown>
            {message.isStreaming && <span className={styles.streamCursor} />}
          </div>
        )}
      </div>
    </article>
  );
});
