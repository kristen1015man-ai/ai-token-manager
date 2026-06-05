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
  role: text("role", { enum: ["admin", "dept_head", "member"] }).notNull().default("member"),
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
  deprecated: integer("deprecated", { mode: "boolean" }).notNull().default(false),
  syncedAt: integer("synced_at", { mode: "timestamp" }),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ===== 同步黑名单（防止删除的模型被同步回来） =====
export const syncBlacklist = sqliteTable("sync_blacklist", {
  model: text("model").primaryKey(),
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
