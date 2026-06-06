# 健康检查与监控集成指南

系统提供 `GET /api/health` 端点，供负载均衡器、监控工具定时探测服务状态。

---

## 端点说明

### `GET /api/health`

**无需鉴权**（middleware 中已设为公开路由）。

**正常响应（200）：**

```json
{
  "status": "ok",
  "timestamp": "2025-06-06T08:30:00.000Z",
  "version": "0.1.0",
  "db": "ok",
  "responseTimeMs": 3
}
```

**降级响应（503）**：数据库连接异常时返回：

```json
{
  "status": "degraded",
  "timestamp": "2025-06-06T08:30:00.000Z",
  "version": "0.1.0",
  "db": "error",
  "responseTimeMs": 5001
}
```

| 字段 | 说明 |
|------|------|
| `status` | `"ok"` = 一切正常，`"degraded"` = 部分异常 |
| `db` | `"ok"` = 数据库可读，`"error"` = 数据库不可达 |
| `responseTimeMs` | 端点处理耗时（含 DB 查询），可用于响应时间监控 |
| `version` | 当前部署版本（来自 `package.json`） |

---

## 常见监控工具集成

### 1. Nginx 负载均衡健康检查

```nginx
upstream ai_token_manager {
    server 127.0.0.1:3000;
    # Nginx Plus（付费版）支持主动健康检查
    health_check interval=10s fails=3 passes=2 uri=/api/health;
}

# Nginx 开源版：使用 passive check
# 如果连续失败 3 次则临时剔除
upstream ai_token_manager {
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
}
```

### 2. Caddy 负载均衡健康检查

```caddyfile
your-domain.com {
    reverse_proxy localhost:3000 localhost:3001 {
        health_uri   /api/health
        health_interval 10s
        health_timeout 5s
        health_status 200
    }
}
```

### 3. Docker / Docker Compose

```yaml
# docker-compose.yml
services:
  ai-token-manager:
    image: ai-token-manager:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

如果没有 curl，可用 wget：

```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
```

或 Node.js 原生方式（不需要额外安装）：

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]
```

### 4. Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-token-manager
spec:
  template:
    spec:
      containers:
        - name: app
          image: ai-token-manager:latest
          ports:
            - containerPort: 3000
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
```

- **livenessProbe**：Pod 无响应时自动重启
- **readinessProbe**：Pod 未就绪时从 Service 摘除流量

### 5. Prometheus + Alertmanager

#### 5a. Blackbox Exporter（黑盒探测）

```yaml
# blackbox.yml
modules:
  http_health:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: [200]
      method: GET
      fail_if_body_not_matches_regexp:
        - '"status":"ok"'
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'ai-token-manager-health'
    metrics_interval: 30s
    params:
      module: [http_health]
    targets:
      - https://your-domain.com/api/health
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

#### 5b. 告警规则

```yaml
# alert_rules.yml
groups:
  - name: ai-token-manager
    rules:
      - alert: ServiceDown
        expr: probe_success{job="ai-token-manager-health"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "AI Token Manager 服务不可达"
          description: "健康检查连续 2 分钟失败"

      - alert: HighResponseTime
        expr: probe_duration_seconds{job="ai-token-manager-health"} > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "健康检查响应时间超过 5 秒"

      - alert: DegradedStatus
        expr: probe_http_status_code{job="ai-token-manager-health"} == 503
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "服务处于降级状态（数据库异常）"
```

### 6. 飞书机器人告警

配合现有飞书 Webhook 基础设施，可定时检查并发送告警：

```bash
#!/bin/bash
# health-check.sh — 放在 crontab 里每 5 分钟执行一次
# */5 * * * * /opt/ai-token-manager/health-check.sh

HEALTH_URL="https://your-domain.com/api/health"
FEISHU_WEBHOOK="https://open.feishu.cn/open-apis/bot/v2/hook/your-hook-id"

RESPONSE=$(curl -sf -m 10 "$HEALTH_URL" 2>&1)

if [ $? -ne 0 ]; then
  curl -sf -X POST "$FEISHU_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d '{"msg_type":"interactive","card":{"header":{"title":{"tag":"plain_text","content":"🔴 服务不可达"},"template":"red"},"elements":[{"tag":"div","text":{"tag":"lark_md","content":"AI Token Manager 健康检查失败，服务可能已宕机。\n**时间**: '"$(date '+%Y-%m-%d %H:%M:%S')"'**URL**: '"$HEALTH_URL"'"}}]}}'
  exit 1
fi

STATUS=$(echo "$RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ "$STATUS" != "ok" ]; then
  curl -sf -X POST "$FEISHU_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d '{"msg_type":"interactive","card":{"header":{"title":{"tag":"plain_text","content":"🟡 服务降级"},"template":"orange"},"elements":[{"tag":"div","text":{"tag":"lark_md","content":"AI Token Manager 处于降级状态。\n**状态**: '"$STATUS"'\n**时间**: '"$(date '+%Y-%m-%d %H:%M:%S')"'"}}]}}'
fi
```

### 7. Uptime Kuma（自建监控面板）

1. 添加新监控 → HTTP(s) 类型
2. URL: `https://your-domain.com/api/health`
3. 关键词检查：`"status":"ok"`
4. 告警通知：配置飞书 Webhook

---

## 推荐监控策略

| 指标 | 阈值 | 级别 | 动作 |
|------|------|------|------|
| 健康检查失败 | 连续 2 次 | 🔴 严重 | 立即通知 |
| HTTP 503 | 持续 1 分钟 | 🟡 警告 | 通知 + 检查数据库 |
| 响应时间 > 5s | 持续 5 分钟 | 🟡 警告 | 检查负载 |
| 响应时间 > 1s | 持续 15 分钟 | 🔵 信息 | 记录 |

**探测频率建议**：10-30 秒一次。太快会增加无意义负载，太慢会延迟故障发现。
