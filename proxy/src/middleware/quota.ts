import { createMiddleware } from "hono/factory";
import { getDb } from "../../../shared/db.js";
import { quotaRules, users } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";

function monthStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

/**
 * 限额检查中间件
 * 检查顺序：个人 → 部门 → 公司
 */
export const quotaMiddleware = createMiddleware(async (c, next) => {
  const userId = c.get("userId");
  const { db, sqlite } = await getDb();
  const dbAny = sqlite as any;
  const ms = monthStart();

  // 获取用户信息
  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userResult.length === 0) {
    return c.json({ error: { message: "User not found", type: "auth_error" } }, 401);
  }
  const user = userResult[0];

  // 获取所有限额规则
  const rules = await db.select().from(quotaRules);

  // 辅助函数：查询本月已用费用
  const getUsed = (query: string, params: unknown[]) => {
    const r = dbAny.exec(query, params);
    return Number(r[0]?.values[0]?.[0] ?? 0);
  };

  // 检查个人限额
  const personalRule = rules.find((r) => r.scope === "personal" && r.targetId === userId);
  if (personalRule) {
    const used = getUsed(
      `SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?`,
      [userId, ms]
    );
    if (used >= personalRule.monthlyLimit) {
      return c.json({
        error: {
          message: `您的本月额度已用完（${used.toFixed(2)}/${personalRule.monthlyLimit.toFixed(2)}元），请联系管理员申请提额`,
          type: "quota_exceeded",
          quota_info: { used, limit: personalRule.monthlyLimit, scope: "personal" },
        },
      }, 429);
    }
  }

  // 检查部门限额
  if (user.departmentId) {
    const deptRule = rules.find((r) => r.scope === "department" && r.targetId === user.departmentId);
    if (deptRule) {
      const used = getUsed(
        `SELECT COALESCE(SUM(ul.cost), 0) FROM usage_logs ul
         JOIN users u ON ul.user_id = u.id
         WHERE u.department_id = ? AND ul.created_at >= ?`,
        [user.departmentId, ms]
      );
      if (used >= deptRule.monthlyLimit) {
        return c.json({
          error: {
            message: `您所在部门本月预算已用完（${used.toFixed(2)}/${deptRule.monthlyLimit.toFixed(2)}元）`,
            type: "quota_exceeded",
            quota_info: { used, limit: deptRule.monthlyLimit, scope: "department" },
          },
        }, 429);
      }
    }
  }

  // 检查公司限额
  const companyRule = rules.find((r) => r.scope === "company");
  if (companyRule) {
    const used = getUsed(
      `SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE created_at >= ?`,
      [ms]
    );
    if (used >= companyRule.monthlyLimit) {
      return c.json({
        error: {
          message: `公司本月AI预算已用完（${used.toFixed(2)}/${companyRule.monthlyLimit.toFixed(2)}元）`,
          type: "quota_exceeded",
          quota_info: { used, limit: companyRule.monthlyLimit, scope: "company" },
        },
      }, 429);
    }
  }

  await next();
});
