import "./login-anim.css";

// 强制动态渲染
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const feishuAppId = process.env.NEXT_PUBLIC_FEISHU_APP_ID || "";
  const redirectUri = process.env.NEXT_PUBLIC_FEISHU_REDIRECT_URI || "";
  const feishuAuthUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${feishuAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=login`;

  return (
    <div className="login-bg min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* 背景装饰圆环 */}
      <div className="login-ring-1" />
      <div className="login-ring-2" />
      <div className="login-ring-3" />

      {/* 主卡片 */}
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo-wrap">
          <img src="/logo.png" alt="玄牝" className="login-logo" />
        </div>

        {/* 标题 */}
        <h1 className="login-title">玄牝词元管理系统</h1>
        <p className="login-slogan">玄牝之门，天地智根</p>

        {/* 飞书登录按钮 */}
        <a href={feishuAuthUrl} className="login-btn">
          <svg className="login-btn-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.5 10.6c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1H5.6c-1.2 0-2.1-.9-2.1-2.1v-2.4zm8.5 0c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1h-2.4c-1.2 0-2.1-.9-2.1-2.1v-2.4zm-4.3-6c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1H9.8c-1.2 0-2.1-.9-2.1-2.1V4.6zm0 12c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1H9.8c-1.2 0-2.1-.9-2.1-2.1v-2.4z"/>
          </svg>
          飞书登录
        </a>
      </div>
    </div>
  );
}
