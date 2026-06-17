# HTTPS 反向代理配置指南

生产环境部署 AI Token Manager 时，需要在应用前面放一层反向代理来处理 HTTPS 终止（TLS）。

下面提供 **Nginx** 和 **Caddy** 两种方案，任选其一。

---

## 架构示意

```
客户端（浏览器 / API 调用）
       ↓ HTTPS (443)
  反向代理 (Nginx / Caddy)
       ↓ HTTP (3000)
  AI Token Manager (Next.js)
```

---

## 方案一：Nginx（推荐用于已有 Nginx 基础设施的环境）

### 1. 安装 Nginx

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y nginx

# CentOS / RHEL
sudo yum install -y nginx
```

### 2. 获取 SSL 证书

推荐使用 Let's Encrypt（免费自动续期）：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

如果已有证书，把 `fullchain.pem` 和 `privkey.pem` 放到 `/etc/nginx/ssl/` 目录。

### 3. 配置文件

创建 `/etc/nginx/sites-available/ai-token-manager`：

```nginx
# ========== 上游应用 ==========
upstream ai_token_manager {
    server 127.0.0.1:3000;
    keepalive 64;
}

# ========== HTTP → HTTPS 重定向 ==========
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com;

    # Let's Encrypt 验证路径
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ========== HTTPS 主配置 ==========
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com;

    # ----- SSL 证书 -----
    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # ----- SSL 安全参数 -----
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # ----- HSTS（强制 HTTPS，启用前确认证书能自动续期）-----
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # ----- 安全头（应用层也加，这里做双保险）-----
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # ----- 日志 -----
    access_log /var/log/nginx/ai-token-manager.access.log;
    error_log  /var/log/nginx/ai-token-manager.error.log;

    # ----- 请求体大小限制（适配大模型请求）-----
    client_max_body_size 50m;

    # ----- 代理转发 -----
    location / {
        proxy_pass http://ai_token_manager;

        # 透传真实客户端信息
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（如有需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时设置（大模型推理可能耗时较长）
        proxy_connect_timeout 60s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;

        # 关闭缓冲，流式输出时立即转发
        proxy_buffering off;
        proxy_cache off;
    }

    # ----- 健康检查不走代理（可选：直接探测 Node 进程）-----
    location /api/health {
        proxy_pass http://ai_token_manager;
        proxy_set_header Host $host;
        access_log off;  # 健康检查不打日志
    }
}
```

### 4. 启用配置

```bash
# 创建软链接启用站点
sudo ln -s /etc/nginx/sites-available/ai-token-manager /etc/nginx/sites-enabled/

# 测试配置语法
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

---

## 方案二：Caddy（推荐用于快速部署、自动 HTTPS）

Caddy 的最大优势是**自动申请和续期 HTTPS 证书**，零配置 TLS。

### 1. 安装 Caddy

```bash
# Ubuntu / Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 2. 配置文件

编辑 `/etc/caddy/Caddyfile`：

```caddyfile
# 将 your-domain.com 替换为你的实际域名
your-domain.com {
    # 反向代理到 Next.js 应用
    reverse_proxy localhost:3000 {
        # 透传真实客户端 IP
        header_up Host              {host}
        header_up X-Real-IP         {remote_host}
        header_up X-Forwarded-For   {remote_host}
        header_up X-Forwarded-Proto {scheme}

        # 流式输出：关闭缓冲
        flush_interval -1

        # 大模型推理超时设长
        transport http {
            read_timeout  300s
            write_timeout 300s
        }
    }

    # 请求体大小限制
    request_body {
        max_size 50MB
    }

    # 安全头（Caddy 自动处理 HSTS 以外的头部）
    header {
        X-Frame-Options           DENY
        X-Content-Type-Options    nosniff
        Referrer-Policy           strict-origin-when-cross-origin
        Permissions-Policy        "camera=(), microphone=(), geolocation=()"
        # Caddy 自动管理 Strict-Transport-Security
    }

    # 日志
    log {
        output file /var/log/caddy/ai-token-manager.log
        format json
    }
}
```

### 3. 启动

```bash
# 启动 Caddy（自动申请 HTTPS 证书）
sudo systemctl restart caddy

# 查看状态
sudo systemctl status caddy
```

> **前提**：域名 DNS 已解析到本机公网 IP，且 80/443 端口对外开放。Caddy 会自动完成证书申请。

---

## 关键配置说明

| 配置项 | 值 | 原因 |
|--------|-----|------|
| 代理超时 | 300 秒 | 大模型推理响应慢，避免 504 |
| 请求体限制 | 50 MB | 长文本/多轮对话请求体可能很大 |
| 关闭缓冲 | `proxy_buffering off` / `flush_interval -1` | 流式输出（SSE）需要逐字节转发 |
| HSTS | 63072000 秒（2年） | 强制浏览器只用 HTTPS 访问 |
| WebSocket | Upgrade 头透传 | 如后续需要实时推送功能 |

---

## 环境变量对应调整

启用反向代理后，修改 `.env` 中的相关变量：

```bash
# 代理网关地址改为外部 HTTPS 地址
PROXY_BASE_URL=https://your-domain.com/v1

# 飞书回调地址
FEISHU_REDIRECT_URI=https://your-domain.com/api/auth/feishu/callback

# CORS 白名单
CORS_ALLOWED_ORIGINS=https://your-domain.com
```

---

## 验证清单

部署完成后逐项确认：

- [ ] `https://your-domain.com` 能正常访问登录页
- [ ] `https://your-domain.com/api/health` 返回 `{"status":"ok"}`
- [ ] 浏览器地址栏显示 🔒 锁图标，证书有效
- [ ] `curl -v https://your-domain.com 2>&1 | grep "HTTP/"` 返回 HTTP/2
- [ ] 流式请求正常（在 ChatGPT 客户端中设置 base_url 后能正常对话）
- [ ] HTTP 自动跳转 HTTPS：`curl -I http://your-domain.com` 返回 301
