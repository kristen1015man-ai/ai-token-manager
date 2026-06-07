"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getMenuForRole, canAccess, ROLE_LABELS, type Role } from "@/lib/permissions";
import { fetchApi } from "@/lib/fetcher";
import PageLoader from "@/components/PageLoader";

interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  department: string | null;
}

/* ===== SVG 图标（Lucide 风格，stroke 2px）===== */
const ICON_MAP: Record<string, React.ReactNode> = {
  chart: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
    </svg>
  ),
  key: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.3 9.3" /><path d="m17 6 4 4" />
    </svg>
  ),
  globe: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
    </svg>
  ),
  building: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  receipt: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" />
    </svg>
  ),
  route: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  ),
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  document: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
    </svg>
  ),
  lock: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  pricetag: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" /><path d="M7 7h.01" />
    </svg>
  ),
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    fetchApi<{ user: UserInfo }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => router.push("/login"));
  }, [router]);

  // 权限守卫
  useEffect(() => {
    if (!user) return;
    if (!canAccess(user.role, pathname)) {
      const menu = getMenuForRole(user.role);
      const fallback = menu[0]?.href || "/dashboard";
      router.replace(fallback);
    }
  }, [user, pathname, router]);

  const handleLogout = () => {
    document.cookie = "token=; path=/; max-age=0";
    router.push("/login");
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50/30">
        <PageLoader fullPage={false} />
      </div>
    );
  }

  const menuItems = getMenuForRole(user.role);

  // 解析多角色徽章
  const userRoles = (user.role || "member").split(",").map((r) => r.trim() as Role).filter(Boolean);
  const roleBadges = userRoles.filter((r) => r !== "member").map((r) => ROLE_LABELS[r]).filter(Boolean);
  if (roleBadges.length === 0) roleBadges.push(ROLE_LABELS.member);

  return (
    <div className="min-h-screen flex">
      {/* ===== 侧边栏 ===== */}
      <aside className="w-56 glass-panel flex flex-col shrink-0 fixed inset-y-0 left-0 z-30">
        {/* Logo 区域 */}
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 flex items-center gap-2.5 text-[15px]">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded-lg shadow-sm" />
            玄牝词元
          </h2>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className={`shrink-0 ${isActive ? "text-indigo-500" : "text-gray-400"}`}>
                  {ICON_MAP[item.icon] || ICON_MAP.document}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 角色徽章 */}
        <div className="p-3 border-t border-gray-100 flex flex-wrap gap-1.5">
          {roleBadges.map((badge) => (
            <span key={badge.label} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
              {badge.label}
            </span>
          ))}
        </div>
      </aside>

      {/* ===== 主内容区 ===== */}
      <div className="flex-1 flex flex-col min-w-0 ml-56">
        {/* 顶部栏 */}
        <header className="h-14 glass-header flex items-center justify-between px-6 shrink-0 sticky top-0 z-20">
          <h1 className="text-lg font-semibold text-gray-900 tracking-tight">
            {menuItems.find((item) => item.href === pathname)?.label || "仪表盘"}
          </h1>
          <div className="flex items-center gap-3">
            {user.avatar && (
              <img src={user.avatar} alt="" className="w-8 h-8 rounded-full ring-2 ring-gray-100 shadow-sm" />
            )}
            <span className="text-sm font-medium text-gray-700">{user.name}</span>
            {user.department && (
              <span className="text-xs text-gray-400 hidden sm:inline">{user.department}</span>
            )}
            <button
              onClick={handleLogout}
              className="ml-2 text-sm text-gray-400 hover:text-indigo-600 transition-colors duration-200"
            >
              退出
            </button>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
