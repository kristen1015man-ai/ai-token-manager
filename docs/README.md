# Sparkloom 文档索引

最后更新：2026-06-18

这组文档用于项目交接、二次开发、Bug 修复、日常维护和用户支持。当前线上已经运行，后续团队应优先阅读本文档索引，再按角色进入对应专项文档。

## 线上事实

- 线上域名：`https://ai.seapllo.com`
- 当前部署：Railway 单服务镜像。
- 容器内进程：`railway/start.mjs` 同时启动 Next.js Web 和 Hono Proxy。
- Web 内部端口：`3000`。
- Proxy 内部端口：`3001`。
- 公网 AI 入口：`/v1/*` 和 `/anthropic/*`。
- 公网管理入口：`/dashboard/*` 和 `/api/*`。
- 公网禁止访问：`/api/internal/*`，入口层直接返回 404。
- 数据库：sql.js SQLite 文件，生产应落在 Railway Volume 或 `DATABASE_URL` 指定的持久路径。

## 阅读路径

| 读者 | 必读文档 | 目的 |
| --- | --- | --- |
| 新接手负责人 | `HANDOVER.md`, `ARCHITECTURE.md`, `OPERATIONS.md` | 建立系统全局认知和上线维护边界 |
| 后端/全栈开发 | `PROJECT-MODULES.md`, `API.md`, `DATABASE-SCHEMA.md`, `PROXY-INTERNALS.md` | 二次开发和 Bug 修复 |
| 运维/平台 | `OPERATIONS.md`, `monitoring.md`, `backup-restore.md`, `reverse-proxy.md` | 部署、监控、备份恢复 |
| 安全/审计 | `SECURITY-PERMISSIONS.md`, `INCIDENT-RUNBOOK.md`, `API.md`, `DATABASE-SCHEMA.md` | 权限、密钥、资金安全审查 |
| 客服/管理员 | `USER-GUIDE.md`, `SUPPORT-RUNBOOK.md`, `TROUBLESHOOTING.md` | 指导员工使用和排查常见问题 |
| 发布负责人 | `RELEASE-CHECKLIST.md`, `ACCEPTANCE-GAP-REPORT.md` | 每次上线前回归验收和交接退回项跟踪 |
| 接收方/验收方 | `HANDOFF-UAT-SIGNOFF.md`, `HANDOFF-EVIDENCE-2026-06-20.md` | 正式 UAT、灾备、资产交割和签收证据 |

## 文档职责

| 文档 | 内容 |
| --- | --- |
| `HANDOVER.md` | 总交接说明，保留关键决策、当前风险和阅读入口 |
| `ARCHITECTURE.md` | 运行架构、请求路由、部署拓扑、数据流 |
| `PROJECT-MODULES.md` | 各模块功能点、关键代码、维护规范 |
| `API.md` | Public API、Web API、Internal API 的契约 |
| `DATABASE-SCHEMA.md` | 数据表、字段含义、写入边界和迁移说明 |
| `PROXY-INTERNALS.md` | Hono Proxy 转发、鉴权、限额、计费、流式处理 |
| `SECURITY-PERMISSIONS.md` | RBAC、密钥、CSRF、SSRF、内部 API 和审计要求 |
| `INCIDENT-RUNBOOK.md` | 生产事故分级、止血、回滚、密钥泄露和费用异常处理 |
| `ACCEPTANCE-GAP-REPORT.md` | 接收方多岗位审查后的 P0/P1/P2 退回清单 |
| `USER-GUIDE.md` | 管理员、员工、财务、部门负责人使用说明 |
| `SUPPORT-RUNBOOK.md` | 一线管理员/客服 SOP、话术和升级标准 |
| `OPERATIONS.md` | 环境变量、部署、重启、日常任务、应急操作 |
| `TROUBLESHOOTING.md` | 登录、密钥、计费、余额、价格、同步、排行榜排障 |
| `RELEASE-CHECKLIST.md` | 上线前检查清单和回归场景 |
| `balance-sync.md` | 余额同步、阈值、提醒、供应商差异 |
| `backup-restore.md` | 数据备份、恢复、计费重置、灾备演练 |
| `HANDOFF-UAT-SIGNOFF.md` | 交接 UAT 与签收表 |
| `HANDOFF-EVIDENCE-2026-06-20.md` | 2026-06-20 线上交接证据 |
| `monitoring.md` | 健康检查、日志、告警、关键指标 |
| `reverse-proxy.md` | Railway 入口层和外部反代约束 |

## 维护原则

- 改业务代码时，同步更新对应专项文档。
- 改 API 请求/响应时，同步更新 `API.md`。
- 改 DB 表、索引、字段或迁移逻辑时，同步更新 `DATABASE-SCHEMA.md`。
- 改权限、密钥、鉴权、内部接口时，同步更新 `SECURITY-PERMISSIONS.md`。
- 改定时任务、部署、环境变量时，同步更新 `OPERATIONS.md` 和 `monitoring.md`。
- 改用户可见流程时，同步更新 `USER-GUIDE.md` 和 `TROUBLESHOOTING.md`。

## 变更流程

所有新增需求先建变更单。变更单必须包含：

- 业务背景。
- 影响页面、API、数据表和定时任务。
- 验收标准。
- 是否涉及资金、权限、密钥、飞书或 DB。
- 回滚方案。

高风险变更必须先由甲方负责人审批，再进入开发。上线前执行 `RELEASE-CHECKLIST.md` 对应项；上线后至少观察 30 分钟日志和关键指标。未写验收标准的需求不得进入开发。
