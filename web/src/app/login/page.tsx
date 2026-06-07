import "./login-anim.css";

// 强制动态渲染
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const feishuAuthUrl = "/api/auth/feishu/start";

  return (
    <div className="login-bg min-h-screen flex items-center justify-center">
      {/* 中心光晕 */}
      <div className="login-glow" />

      {/* 浮动光球 */}
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />
      <div className="login-orb login-orb-3" />

      {/* 粒子光效 — 精简到 12 个 */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="login-particle" style={{
          left: `${15 + Math.random() * 70}%`,
          top: `${20 + Math.random() * 60}%`,
          animationDelay: `${Math.random() * 8}s`,
          animationDuration: `${5 + Math.random() * 6}s`,
          width: `${1 + Math.random() * 2}px`,
          height: `${1 + Math.random() * 2}px`,
          opacity: 0.2 + Math.random() * 0.4,
        }} />
      ))}

      {/* 主内容 — 毛玻璃卡片 */}
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
          <img src="/feishu-logo.ico" alt="" className="login-btn-icon" />
          飞书登录
        </a>
      </div>
    </div>
  );
}
