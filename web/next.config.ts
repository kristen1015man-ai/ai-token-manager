import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sql.js", "xlsx"],
  allowedDevOrigins: ["192.168.101.220"],
  // 代理路由需要大请求体（长对话上下文）
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // 内容安全策略：限制脚本/连接来源，降低 XSS 后密钥被外泄的风险
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss://localhost:*",
              "img-src 'self' data: https:",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
