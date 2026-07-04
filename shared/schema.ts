import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ===== 用户表 =====
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  feishuId: text("feishu_id").notNull().unique(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  email: text("email"),
  department: text("department"),
  departmentId: text("department_id"),
  groupName: text("group_name"),
  groupId: text("group_id"),
  centerName: text("center_name"),
  centerId: text("center_id"),
  employeeId: text("employee_id"),
  apiKey: text("api_key").notNull().unique(),
  apiKeyHash: text("api_key_hash"),  // HMAC-SHA256 可搜索哈希，用于 SQL WHERE 精确匹配
  role: text("role").notNull().default("member"),  // 逗号分隔多角色: admin,finance,dept_manager,member
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  monthlyQuota: real("monthly_quota").default(200),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== 上游渠道表 =====
export const userApiKeys = sqliteTable("user_api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  keyHash: text("key_hash").notNull().unique(),
  keyEncrypted: text("key_encrypted").notNull(),
  maskedKey: text("masked_key").notNull(),
  name: text("name").notNull().default("API Key"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  models: text("models", { mode: "json" }).$type<string[]>().notNull(),
  priority: integer("priority").notNull().default(0),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  currency: text("currency").notNull().default("CNY"),   // "CNY" | "USD"
  provider: text("provider"),                               // "deepseek" | "glm" | "openai" | "anthropic" | "siliconflow"
  balance: real("balance"),                                  // 当前余额（null=从未同步）
  balanceCurrency: text("balance_currency"),                 // 余额币种 "CNY"|"USD"
  balanceSyncMode: text("balance_sync_mode"),                // "auto"|"manual"|null（null=按供应商自动判断）
  balanceSyncedAt: integer("balance_synced_at", { mode: "timestamp" }), // 最后同步时间
  balanceAlertThreshold: real("balance_alert_threshold"),    // 单渠道预警阈值（null=用全局默认）
  accessKeyId: text("access_key_id"),                         // 阿里云 AccessKey ID（用于 BSS 余额查询）
  accessKeySecret: text("access_key_secret"),                 // 阿里云 AccessKey Secret
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== 用量记录表（Phase 2 创建，此处预定义） =====
export const usageLogs = sqliteTable("usage_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  cost: real("cost").notNull().default(0),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== 限额规则表 =====
export const quotaRules = sqliteTable("quota_rules", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["company", "department", "personal"] }).notNull(),
  targetId: text("target_id").notNull(),
  monthlyLimit: real("monthly_limit").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== 预警记录表 =====
export const alertLogs = sqliteTable("alert_logs", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: [
      "personal_80",
      "personal_100",
      "dept_80",
      "company_90",
      "anomaly",
      "balance_low",
      "employee_departed",
      "leaderboard",
    ],
  }).notNull(),
  targetId: text("target_id").notNull(),
  message: text("message").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== 模型价格表 =====
export const modelPrices = sqliteTable("model_prices", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  channelId: text("channel_id"),
  inputPerMillion: real("input_per_million").notNull(),
  outputPerMillion: real("output_per_million").notNull(),
  cachePerMillion: real("cache_per_million").notNull().default(0),
  displayName: text("display_name"),
  currency: text("currency").notNull().default("CNY"),   // 价格的原始币种 "CNY" | "USD"
  deprecated: integer("deprecated", { mode: "boolean" }).notNull().default(false),
  syncedAt: integer("synced_at", { mode: "timestamp" }),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ===== 同步黑名单（防止删除的模型被同步回来） =====
// 复合主键：(model, channel_id) — 支持"全局黑名单"和"渠道级黑名单"
export const syncBlacklist = sqliteTable("sync_blacklist", {
  model: text("model").notNull(),
  channelId: text("channel_id"),   // NULL = 全局黑名单，非 NULL = 渠道级黑名单
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ===== 预警设置表 =====
export const alertSettings = sqliteTable("alert_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== 管理操作日志表 =====
export const adminLogs = sqliteTable("admin_logs", {
  id: text("id").primaryKey(),
  adminId: text("admin_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ===== Sparkloom Studio local-agent workspace state =====
export const studioSessions = sqliteTable("studio_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull().default("New Studio Session"),
  defaultModel: text("default_model"),
  mode: text("mode", { enum: ["default", "plan", "auto", "review", "safe_auto"] })
    .notNull()
    .default("default"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studioMessages = sqliteTable("studio_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => studioSessions.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studioAgentDevices = sqliteTable("studio_agent_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  deviceName: text("device_name").notNull(),
  platform: text("platform"),
  agentVersion: text("agent_version"),
  publicKey: text("public_key"),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  pairedAt: integer("paired_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
});

export const studioProjects = sqliteTable("studio_projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id")
    .references(() => studioAgentDevices.id),
  name: text("name").notNull(),
  rootHash: text("root_hash").notNull(),
  lastOpenedAt: integer("last_opened_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studioCommands = sqliteTable("studio_commands", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => studioSessions.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id")
    .references(() => studioAgentDevices.id),
  projectId: text("project_id")
    .references(() => studioProjects.id),
  mode: text("mode", { enum: ["default", "plan", "auto", "review", "safe_auto"] })
    .notNull()
    .default("default"),
  commandSummary: text("command_summary").notNull(),
  commandHash: text("command_hash").notNull(),
  status: text("status", {
    enum: ["pending_confirmation", "running", "succeeded", "failed", "cancelled", "blocked"],
  })
    .notNull()
    .default("pending_confirmation"),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high", "blocked"] })
    .notNull()
    .default("medium"),
  exitCode: integer("exit_code"),
  outputHash: text("output_hash"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
