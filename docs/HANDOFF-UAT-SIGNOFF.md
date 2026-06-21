# Sparkloom 交接 UAT 与签收表

最后更新：2026-06-20

本文档用于正式交接签收。所有测试均应在生产环境或接收方认可的准生产环境执行，并把截图、日志、变更单编号或导出结果归档到公司受控位置。

## 1. 基本信息

| 项目 | 填写 |
| --- | --- |
| 系统名称 | Sparkloom |
| 域名 | `https://ai.seapllo.com` |
| 验收环境 |  |
| 验收日期 |  |
| 甲方负责人 |  |
| 乙方交接人 |  |
| 接收方技术负责人 |  |
| Railway 项目/环境 | `heartfelt-education` / `production` |
| 当前稳定 deployment | `6dc8dfa0-0bb1-4ab0-95ac-52149f1fcbea` |
| 当前 handoff tag | `handoff-2026-06-20` |
| 当前 handoff commit | 以 `pnpm handoff:status` 输出的 `tagCommit` 为准 |

## 2. 技术门禁

| 编号 | 验收项 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| T-01 | `pnpm install --frozen-lockfile` | 通过 | 命令输出 |  |
| T-02 | `pnpm test` | `Handoff gate passed` | 命令输出 |  |
| T-03 | `pnpm handoff:status` | `ok=true`，`tagMatchesHead=true`，`workspaceClean=true` | 命令输出 |  |
| T-04 | `pnpm --filter web lint` | TypeScript 无错误 | 命令输出 |  |
| T-05 | `pnpm --filter web build` | Next production build 通过 | 命令输出 |  |
| T-06 | `pnpm --filter proxy build` | Proxy TypeScript build 通过 | 命令输出 |  |
| T-07 | `git diff --check` | 无空白错误 | 命令输出 |  |
| T-08 | `https://ai.seapllo.com/health` | HTTP 200，`status=ok` | 响应摘要 |  |
| T-09 | `https://ai.seapllo.com/api/health` | HTTP 200，`status=ok` | 响应摘要 |  |
| T-10 | `node scripts/production-smoke.mjs --base https://ai.seapllo.com` | 公网安全 smoke 通过；缺员工 Key 时 `complete=false` 属正常，不代表业务 UAT 完成 | 命令输出 |  |
| T-11 | `pnpm handoff:uat -- --out <受控目录>` | 生成脱敏自动证据，不包含明文 Key/Secret | 证据文件 |  |
| T-12 | 复制 `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json` 到受控目录并填写 | 自动证据、usage 入库核对、费用核对、脱敏审查均完成 | `handoff-business-uat-signoff.json` |  |
| T-13 | 复制 `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json` 到受控目录并填写 | SQLite 校验、外部存储、恢复演练、回滚演练均完成 | `handoff-backup-restore-signoff.json` |  |
| T-14 | 复制 `docs/HANDOFF-ASSET-SIGNOFF.template.json` 到受控目录并填写 | 八项资产均 `complete=true`，且每项都有 owner、permission、evidenceRef | `handoff-asset-signoff.json` |  |
| T-15 | `pnpm handoff:final -- --uat-evidence <uat-file> --backup-verification <backup-file> --asset-signoff <asset-file>` | `ok=true`，`formalSignoffReady=true` | 命令输出 |  |

## 3. 登录与权限

| 编号 | 角色 | 操作 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- | --- |
| A-01 | 管理员 | 使用飞书登录 | 进入后台，顶部显示管理员标识 | 截图 |  |
| A-02 | 普通员工 | 使用飞书登录 | 进入个人 Key 页面，不可访问管理页 | 截图 |  |
| A-03 | 普通员工 | 访问 `/dashboard/admin` | 被拒绝或重定向 | 截图/HTTP 状态 |  |
| A-04 | 财务 | 访问财务概览和导出 | 可读财务数据，不可查看渠道密钥 | 截图 |  |
| A-05 | 部门负责人 | 查看部门数据 | 仅显示本人部门范围 | 截图 |  |
| A-06 | 管理员降级测试 | 移除管理角色后复登 | 旧 session 不保留管理权限 | 截图/日志 |  |

## 4. 员工 Key 与客户端调用

| 编号 | 操作 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| K-01 | 新员工首次进入 Key 页面 | 默认没有可复制的历史明文 Key | 截图 |  |
| K-02 | 新建员工 Key | 只在创建后显示一次明文 `sk-emp-...` | 截图，注意脱敏 |  |
| K-03 | 刷新页面 | 只能看到 masked key，不能再次复制明文 | 截图 |  |
| K-04 | 删除 Key | 可删除，但至少保留一个有效 Key 或要求先新建替代 Key | 截图 |  |
| K-05 | 普通兼容客户端 | Base URL 使用 `https://ai.seapllo.com/v1`，Key 使用本系统员工 Key | 成功调用记录 |  |
| K-06 | Claude Code | Base URL 使用 `https://ai.seapllo.com/anthropic`，Key 使用本系统员工 Key | 成功调用记录 |  |
| K-07 | 员工 Key 冒烟 | `SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... node scripts/production-smoke.mjs --base https://ai.seapllo.com --require-employee` | `/v1/models` 通过，输出不包含明文 Key |  |
| K-08 | 员工 Key 证据包 | `SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... pnpm handoff:uat -- --out <受控目录>` | 证据 JSON 中 `employeeModels.ok=true`，不包含明文 Key |  |

## 5. 模型调用与计费

| 编号 | 操作 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| B-01 | 调用 `/v1/models` | 返回可用模型列表 | 响应摘要 |  |
| B-02 | 小额调用 DeepSeek 模型 | 请求成功，usage 入库 | 请求 ID、后台记录 |  |
| B-03 | 小额调用 SiliconFlow 模型 | 请求成功，usage 入库 | 请求 ID、后台记录 |  |
| B-04 | 流式调用 | 结束后能记录 usage；无 usage 时按系统策略处理 | 请求记录 |  |
| B-05 | 今日统计 | 今日时间按北京时间计算 | 后台截图 |  |
| B-06 | 月额度百分比 | 本月额度条显示金额和百分比 | 截图 |  |
| B-07 | 个人阈值通知 | 修改个人阈值后按新阈值触发，不固定 80% | 飞书通知 |  |
| B-08 | 超额阻断 | 达到 100% 后才拒绝请求 | 请求记录 |  |
| B-09 | 费用核对 | 系统计费与上游余额变化在可解释误差范围内 | 对账表 |  |
| B-10 | 小额计费冒烟 | `SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... node scripts/production-smoke.mjs --base https://ai.seapllo.com --allow-billable --require-billable --chat-model <model>` | 请求成功，usage 入库；只用接收方认可的小额模型 |  |
| B-11 | 小额流式冒烟 | 在 B-10 命令后追加 `--include-stream --require-stream` | SSE 返回成功，结束后 usage 入库 |  |
| B-12 | 小额计费自动证据包 | `SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... pnpm handoff:uat -- --allow-billable --chat-model <model> --include-stream --out <受控目录>` | `formalBusinessUatComplete=true`，非流式和流式检查均通过 |  |
| B-13 | 业务 UAT 结构化签收 | 复制 `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json` 到受控目录并填写 | `automatedEvidence`、`usageAudit`、`securityReview` 均完成，费用核对证据归档 |  |

## 6. 渠道、余额和价格

| 编号 | 操作 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| C-01 | DeepSeek 余额同步 | 显示真实余额，失败有错误原因 | 截图/日志 |  |
| C-02 | SiliconFlow 余额同步 | 显示真实余额，不出现负值误报 | 截图/日志 |  |
| C-03 | 禁用渠道 | 禁用后不参与低余额告警和路由 | 截图/日志 |  |
| C-04 | 每小时余额同步 | 自动同步执行，非提醒时不刷群 | 日志 |  |
| C-05 | 余额提醒 | 北京时间 09:30、12:00、14:30、17:30 按阈值提醒 | 飞书消息 |  |
| C-06 | 模型价格同步 | 同步条数与页面显示一致，兜底价格有提示 | 截图 |  |
| C-07 | 模型价格手改 | 保存后不会被异常恢复 | 前后截图 |  |

## 7. 飞书同步与通知

| 编号 | 操作 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| F-01 | 飞书全员登录授权 | 真实员工可授权进入系统 | 截图 |  |
| F-02 | 通讯录同步 | 员工数量与飞书数据范围一致 | 同步日志 |  |
| F-03 | 部门映射 | 映射表生效，不误判大量离职 | 前后对比 |  |
| F-04 | 入离职变化 | 新员工新增，离职员工按规则停用 | 同步日志 |  |
| F-05 | 余额低提醒收件人 | 人员选择展示完整头像/姓名 | 截图 |  |
| F-06 | 排行榜测试发送 | 手动测试能发送到选定群 | 飞书消息 |  |
| F-07 | 群组同步 | 机器人所在群可被同步并选择 | 截图 |  |

## 8. 灾备与恢复

正式灾备签收必须使用 `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json`。`node scripts/verify-sqlite-backup.mjs <data.db>` 只证明 SQLite 文件可读和核心表存在；正式灾备应优先执行 `node scripts/verify-sqlite-backup.mjs <backup-dir>`，确认 `data.db`、`manifest.json`、`usage-queue.jsonl`、`usage-dead-letter.jsonl` 成套存在，但这仍不替代外部受控存储、临时环境恢复和回滚演练签收。

| 编号 | 操作 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| D-01 | 生产卷内备份校验 | 已有 `/data/backups/handoff-2026-06-20T02-50-12-179Z`，`integrity=ok` | `HANDOFF-EVIDENCE` | 通过 |
| D-02 | 下载备份到公司受控存储 | `data.db`、`manifest.json`、queue 文件归档 | 存储路径/权限截图 |  |
| D-03 | 校验下载后的完整备份目录 | `node scripts/verify-sqlite-backup.mjs <backup-dir>` 返回 `ok=true`、`inputType=backup-directory`、`manifestMatches=true` | 命令输出 |  |
| D-04 | 临时环境恢复 | 临时环境启动成功，health ok | 截图/日志 |  |
| D-05 | 恢复后业务校验 | 登录、渠道、价格、usage、余额、通知配置可读 | 截图 |  |
| D-06 | 回滚演练 | 明确回滚 deployment 和 DB 的步骤 | 变更单 |  |
| D-07 | 灾备签收 JSON | `sqliteVerification`、`externalStorage`、`restoreDrill`、`rollbackDrill` 均完成 | `handoff-backup-restore-signoff.json` |  |

## 9. 资产交割

资产交割必须使用 `docs/HANDOFF-ASSET-SIGNOFF.template.json` 作为结构化签收模板。实际填写文件应放在公司受控目录或变更单附件中，不要提交到 Git。`owner` 填实际负责人或团队，`permission` 填已确认的权限级别，`evidenceRef` 填截图、审批单、密钥库记录、平台权限页或存储路径编号。禁止在该 JSON 中写入明文 Key、Secret、cookie 或 token。

| 编号 | 资产 | 期望结果 | 证据 | 结果 |
| --- | --- | --- | --- | --- |
| O-01 | 代码仓库 | 接收方可拉取 handoff tag、查看提交历史、创建分支和提交变更 | 权限截图/仓库邀请记录 |  |
| O-02 | Railway 项目 | 接收方管理员拥有 Project、Service、Variables、Deployments、Volume 权限 | 权限截图 |  |
| O-03 | 域名/DNS | 接收方确认 owner、解析权限、证书/TLS 管理权限 | 权限截图 |  |
| O-04 | 飞书应用 | 接收方确认应用管理员、OAuth 回调、权限、数据范围、机器人入群 | 权限截图 |  |
| O-05 | 供应商账号 | DeepSeek、SiliconFlow 等 owner、充值责任、Key 轮换流程明确 | 交割记录 |  |
| O-06 | 通知群 | 余额、异常、排行榜通知群 owner 明确，机器人可发送 | 群设置截图 |  |
| O-07 | 生产密钥库 | `JWT_SECRET`、`INTERNAL_API_KEY`、`ENCRYPTION_KEY`、`FEISHU_APP_SECRET` 已进入公司密钥库 | 密钥库记录，禁止明文截图 |  |
| O-08 | 备份存储 | 外部受控备份存储、保留周期、恢复负责人、最近恢复演练明确 | 存储策略/演练记录 |  |

## 10. 签收结论

| 结论 | 勾选 |
| --- | --- |
| 通过，可正式交接 |  |
| 有条件通过，遗留项已有负责人和期限 |  |
| 不通过，需整改后复验 |  |

遗留项：

| 编号 | 问题 | 负责人 | 截止时间 | 处理结果 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

签字：

| 角色 | 姓名 | 日期 |
| --- | --- | --- |
| 甲方负责人 |  |  |
| 乙方交接人 |  |  |
| 接收方技术负责人 |  |  |
