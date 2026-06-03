import "./login-anim.css";

// 强制动态渲染
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const feishuAppId = process.env.NEXT_PUBLIC_FEISHU_APP_ID || "";
  const redirectUri = process.env.NEXT_PUBLIC_FEISHU_REDIRECT_URI || "";
  const feishuAuthUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${feishuAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=login`;

  return (
    <div className="login-bg min-h-screen flex items-center justify-center">
      {/* 中心光晕 */}
      <div className="login-glow" />

      {/* 粒子光效 */}
      {Array.from({ length: 30 }).map((_, i) => (
        <div key={i} className="login-particle" style={{
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 6}s`,
          animationDuration: `${4 + Math.random() * 6}s`,
          width: `${1 + Math.random() * 3}px`,
          height: `${1 + Math.random() * 3}px`,
          opacity: 0.2 + Math.random() * 0.5,
        }} />
      ))}

      {/* 轨道环 */}
      <div className="login-orbit login-orbit-1"><span className="login-orbit-dot" /></div>
      <div className="login-orbit login-orbit-2"><span className="login-orbit-dot" /></div>
      <div className="login-orbit login-orbit-3"><span className="login-orbit-dot" /></div>

      {/* 主内容 */}
      <div className="login-content">
        {/* Logo 外发光 */}
        <div className="login-logo-glow" />

        {/* Logo */}
        <div className="login-logo-wrap">
          <img src="/logo.png" alt="玄牝" className="login-logo" />
        </div>

        {/* 标题 */}
        <h1 className="login-title">玄牝词元管理系统</h1>
        <p className="login-slogan">玄牝之门，天地智根</p>

        {/* 分隔线 */}
        <div className="login-divider" />

        {/* 飞书登录 */}
        <a href={feishuAuthUrl} className="login-btn">
          {/* 飞书 Logo */}
          <img src="/feishu-logo.ico" alt="" className="login-btn-icon" />
          飞书登录
        </a>
      </div>
    </div>
  );
}
