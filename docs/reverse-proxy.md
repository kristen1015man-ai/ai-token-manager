# 入口层和反向代理说明

最后更新：2026-06-18

本文档说明当前线上入口层行为，以及未来如接入 Nginx/Cloudflare 时必须保持的反代规则。

## 1. 当前入口层

当前代码入口：`railway/start.mjs`

它不是 Nginx，但承担反向代理职责：

- 接收 Railway 公网 `PORT`。
- 转发页面和 Web API 到 `127.0.0.1:3000`。
- 转发模型 API 到 `127.0.0.1:3001`。
- 公网屏蔽 `/api/internal/*`。
- 注入 forwarded headers。
- 限制请求体大小。

## 2. 当前转发规则

| 路径 | 目标 |
| --- | --- |
| `/health` | Proxy |
| `/v1/*` | Proxy |
| `/anthropic/*` | Proxy |
| `/api/internal/*` | 404 |
| 其他 | Web |

## 3. 必须保留的安全规则

- 不允许公网访问 `/api/internal/*`。
- 不允许公网直连 Web 内部端口。
- 不允许公网直连 Proxy 内部端口。
- 对外只暴露 HTTPS 域名。
- 保留 `x-forwarded-host`。
- 保留 `x-forwarded-proto=https`。
- SSE 流式请求不能被短超时中断。
- 请求体大小需要有限制。

## 4. 如果未来使用 Nginx

参考规则：

```nginx
location /api/internal/ {
  return 404;
}

location /v1/ {
  proxy_pass http://proxy:3001;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 3600s;
  proxy_buffering off;
}

location /anthropic/ {
  proxy_pass http://proxy:3001;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 3600s;
  proxy_buffering off;
}

location /health {
  proxy_pass http://proxy:3001;
}

location / {
  proxy_pass http://web:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto https;
}
```

## 5. SSE 注意事项

流式接口：

- `/v1/chat/completions` with `stream=true`
- `/anthropic/v1/messages` with `stream=true`

要求：

- 禁用 proxy buffering。
- 增大 read timeout。
- 不要压缩 SSE。
- 不要提前关闭 idle 连接。

## 6. CORS

Proxy CORS 来源：

- 环境变量 `CORS_ALLOWED_ORIGINS`
- 为空时默认只允许 localhost 开发来源。

生产应设置：

```env
CORS_ALLOWED_ORIGINS=https://ai.seapllo.com
```

## 7. 请求体限制

入口层：

- `MAX_REQUEST_BODY_BYTES`
- 默认 2MB

Proxy chat route：

- `MAX_CHAT_BODY_BYTES`
- 默认 2MB

过大请求返回 413。
