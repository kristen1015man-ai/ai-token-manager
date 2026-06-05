"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getMenuForRole, canAccess, ROLE_LABELS, type Role } from "@/lib/permissions";

interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  department: string | null;
}

/* ===== 图标 ===== */
const ICON_MAP: Record<string, string> = {
  chart: "📊", key: "🔑", globe: "🌍", building: "🏢",
  users: "👥", receipt: "🧾", route: "🔀", shield: "🛡️",
  bell: "🔔", document: "📋", lock: "🔒", pricetag: "🏷️",
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
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setUser(data.user))
      .catch(() => router.push("/login"));
  }, [router]);

  // 权限守卫：用户加载后检查当前路径是否可访问
  useEffect(() => {
    if (!user) return;
    if (!canAccess(user.role, pathname)) {
      // 重定向到该角色可见的第一个页面
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">加载中...</div>
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
      {/* 左侧菜单 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-bold text-indigo-600 flex items-center gap-2">
            <img src="/logo.png" alt="" className="w-6 h-6 rounded" />
            玄牝词元
          </h2>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className="text-base">{ICON_MAP[item.icon] || "📄"}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-gray-100 flex flex-wrap gap-1">
          {roleBadges.map((badge) => (
            <span key={badge.label} className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.color}`}>
              {badge.label}
            </span>
          ))}
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
          <h1 className="text-lg font-semibold text-gray-800">
            {menuItems.find((item) => item.href === pathname)?.label || "仪表盘"}
          </h1>
          <div className="flex items-center gap-3">
            {user.avatar && (
              <img src={user.avatar} alt="" className="w-8 h-8 rounded-full" />
            )}
            <span className="text-sm text-gray-700">{user.name}</span>
            {user.department && (
              <span className="text-xs text-gray-400">{user.department}</span>
            )}
            <button
              onClick={handleLogout}
              className="ml-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
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
