"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  department: string | null;
}

const memberMenuItems = [
  { label: "我的用量", href: "/dashboard", icon: "chart" },
  { label: "API Key", href: "/dashboard/key", icon: "key" },
];

const adminMenuItems = [
  ...memberMenuItems,
  { label: "全局概览", href: "/dashboard/admin", icon: "globe" },
  { label: "部门排行", href: "/dashboard/admin/departments", icon: "building" },
  { label: "员工排行", href: "/dashboard/admin/employees", icon: "users" },
  { label: "部门分账", href: "/dashboard/admin/billing", icon: "receipt" },
  { label: "渠道管理", href: "/dashboard/admin/channels", icon: "route" },
  { label: "限额设置", href: "/dashboard/admin/quotas", icon: "shield" },
  { label: "预警记录", href: "/dashboard/admin/alerts", icon: "bell" },
  { label: "操作日志", href: "/dashboard/admin/logs", icon: "document" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    const token = document.cookie
      .split("; ")
      .find((row) => row.startsWith("token="));
    if (!token) {
      router.push("/login");
      return;
    }
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setUser(data.user))
      .catch(() => router.push("/login"));
  }, [router]);

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

  const menuItems = user.role === "admin" ? adminMenuItems : memberMenuItems;

  return (
    <div className="min-h-screen flex">
      {/* 左侧菜单 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-bold text-indigo-600 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            AI Token 管家
          </h2>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {user.role === "admin" && (
          <div className="p-3 border-t border-gray-100">
            <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
              管理员
            </span>
          </div>
        )}
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
