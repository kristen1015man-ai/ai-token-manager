"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getMenuForRole, canAccess, type MenuItem, type Role } from "@/lib/permissions";
import { fetchApi } from "@/lib/fetcher";
import { BRAND_NAME } from "@/lib/brand";
import PageLoader from "@/components/PageLoader";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  department: string | null;
}

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

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="dashboard-icon-button"
      title={theme === "light" ? "切换深色模式" : "切换浅色模式"}
      aria-label="切换主题"
      type="button"
    >
      {theme === "light" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
    </button>
  );
}

function NavItemLink({ item, active }: { item: MenuItem; active: boolean }) {
  return (
    <Link href={item.href} className={`dashboard-nav-link ${active ? "dashboard-nav-link-active" : ""}`}>
      <span className="dashboard-nav-icon">{ICON_MAP[item.icon] || ICON_MAP.document}</span>
      <span>{item.label}</span>
    </Link>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    fetchApi<{ user: UserInfo }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    if (!canAccess(user.role, pathname)) {
      const menu = getMenuForRole(user.role);
      const fallback = menu[0]?.href || "/dashboard";
      router.replace(fallback);
    }
  }, [user, pathname, router]);

  useEffect(() => {
    setAdminOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!adminOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setAdminOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [adminOpen]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
  };

  const { primaryItems, adminItems } = useMemo(() => {
    const menuItems = user ? getMenuForRole(user.role) : [];
    return {
      primaryItems: menuItems.filter((item) => !item.href.startsWith("/dashboard/admin")),
      adminItems: menuItems.filter((item) => item.href.startsWith("/dashboard/admin")),
    };
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--body-bg, #ffffff)" }}>
        <PageLoader fullPage={false} />
      </div>
    );
  }

  const userRoles = (user.role || "member").split(",").map((r) => r.trim() as Role).filter(Boolean);
  const isAdmin = userRoles.includes("admin");
  const adminActive = adminItems.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));

  return (
    <ThemeProvider>
      <div className="dashboard-shell">
        <header className="dashboard-topbar">
          <Link href="/dashboard" className="brand-lockup" aria-label={BRAND_NAME}>
            <span className="brand-nav-logo-wrap">
              <img src="/logo.png" alt={BRAND_NAME} className="brand-nav-logo" />
            </span>
            <span className="brand-wordmark brand-wordmark--nav">{BRAND_NAME}</span>
          </Link>

          <nav className="dashboard-nav" aria-label="主导航">
            {primaryItems.map((item) => (
              <NavItemLink key={item.href} item={item} active={pathname === item.href} />
            ))}

            {adminItems.length > 0 && (
              <div className="dashboard-admin-menu" ref={dropdownRef}>
                <button
                  className={`dashboard-nav-link dashboard-admin-trigger ${adminActive ? "dashboard-nav-link-active" : ""}`}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={adminOpen}
                  onClick={() => setAdminOpen((open) => !open)}
                >
                  <span className="dashboard-nav-icon">{ICON_MAP.globe}</span>
                  <span>管理</span>
                  <svg className={`dashboard-chevron ${adminOpen ? "dashboard-chevron-open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {adminOpen && (
                  <div className="dashboard-admin-dropdown" role="menu">
                    {adminItems.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(item.href + "/");
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`dashboard-admin-option ${active ? "dashboard-admin-option-active" : ""}`}
                          role="menuitem"
                        >
                          <span className="dashboard-nav-icon">{ICON_MAP[item.icon] || ICON_MAP.document}</span>
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>

          <div className="dashboard-userbar">
            <ThemeToggleButton />
            <div className="dashboard-user-meta">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="dashboard-avatar" />
              ) : (
                <span className="dashboard-avatar dashboard-avatar-fallback">{user.name.charAt(0)}</span>
              )}
              <div className="dashboard-user-text">
                <span className="dashboard-user-name">{user.name}</span>
                {isAdmin && <span className="dashboard-admin-badge-inline">管理员</span>}
              </div>
            </div>
            <button onClick={handleLogout} className="dashboard-logout" type="button">
              退出
            </button>
          </div>
        </header>

        <main className="dashboard-main">{children}</main>
      </div>
    </ThemeProvider>
  );
}
