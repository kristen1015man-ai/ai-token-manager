# Sparkloom

公司内部 AI API 网关和用量管理后台。

当前线上地址：`https://ai.seapllo.com`

## 当前状态

- 已上线。
- 当前生产部署是 Railway 单服务镜像。
- 容器内由 `railway/start.mjs` 同时启动 Next.js Web 和 Hono Proxy。
- Web 负责后台、飞书、权限、DB 和内部 API。
- Proxy 负责 `/v1/*` 和 `/anthropic/*` 模型转发。
- `/api/internal/*` 对公网返回 404。
- 数据库是 sql.js SQLite 文件，生产必须放在 Railway Volume 或 `DATABASE_URL` 指定的持久路径。

## 文档入口

后续交接、二次开发、Bug 修复、运维和用户支持，统一从这里开始：

- [文档索引](docs/README.md)
- [总交接说明](docs/HANDOVER.md)
- [系统架构](docs/ARCHITECTURE.md)
- [模块功能说明](docs/PROJECT-MODULES.md)
- [API 契约](docs/API.md)
- [数据库说明](docs/DATABASE-SCHEMA.md)
- [安全与权限规范](docs/SECURITY-PERMISSIONS.md)
- [运维手册](docs/OPERATIONS.md)
- [故障排查手册](docs/TROUBLESHOOTING.md)
- [上线前回归检查清单](docs/RELEASE-CHECKLIST.md)

## 员工使用入口

OpenAI 兼容客户端：

```text
Base URL: https://ai.seapllo.com/v1
API Key: 用户在后台新建的 sk-emp-...
```

Claude Code：

```text
Base URL: https://ai.seapllo.com/anthropic
API Key: 用户在后台新建的 sk-emp-...
```

员工不能使用 DeepSeek、硅基流动等供应商官方 Key 调用本系统。

## 本地开发

安装依赖：

```bash
pnpm install --frozen-lockfile
```

启动 Web：

```bash
pnpm --filter web dev
```

启动 Proxy：

```bash
pnpm --filter proxy dev
```

构建检查：

```bash
pnpm --filter web build
pnpm --filter proxy build
pnpm --filter web lint
```

生产相关配置请看 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 安全注意

- 不要提交 `.env`。
- 不要提交飞书 Secret、供应商 Key、员工 `sk-emp-...` Key。
- 不要把 Railway 变量完整输出到聊天或文档。
- `ENCRYPTION_KEY` 一旦用于生产数据，不可随意更换。
- 改权限、密钥、计费、限额、内部 API 时，必须同步更新交接文档并跑回归清单。
