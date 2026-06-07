"use client";

import { useEffect, useState, useRef } from "react";
import { fetchApi, ApiError } from "../../../../lib/fetcher";
import Avatar from "@/components/Avatar";
import PageLoader from "@/components/PageLoader";

/* ===== 类型 ===== */
interface User {
  id: string;
  name: string;
  avatar: string | null;
  department: string | null;
  roles: string[];
}

interface GroupDef {
  key: string;
  label: string;
  description: string;
  color: string;
  borderColor: string;
  bgColor: string;
  badgeColor: string;
  emptyText: string;
}

/* ===== 分组定义 ===== */
const GROUPS: GroupDef[] = [
  {
    key: "admin",
    label: "管理员",
    description: "拥有所有管理权限（渠道、价格、限额、权限等）",
    color: "text-red-700",
    borderColor: "border-red-200",
    bgColor: "bg-red-50",
    badgeColor: "bg-red-50 text-red-700",
    emptyText: "暂无管理员",
  },
  {
    key: "finance",
    label: "财务",
    description: "全局概览 + 费用导出 + 部门分账（只读）",
    color: "text-emerald-700",
    borderColor: "border-emerald-200",
    bgColor: "bg-emerald-50",
    badgeColor: "bg-emerald-50 text-emerald-700",
    emptyText: "暂无财务人员",
  },
  {
    key: "dept_manager",
    label: "部门负责人",
    description: "查看本部门排行 + 员工排行 + 本部门分账（只读）",
    color: "text-amber-700",
    borderColor: "border-amber-200",
    bgColor: "bg-amber-50",
    badgeColor: "bg-amber-50 text-amber-700",
    emptyText: "暂无部门负责人",
  },
];

/* ===== 主组件 ===== */
export default function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<string | null>(null); // 当前展开添加的组
  const [searchText, setSearchText] = useState("");
  const [saving, setSaving] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    fetchApi<{ users: User[] }>("/api/admin/permissions")
      .then((data) => {
        setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => {
        setUsers([]);
        setLoading(false);
      });
  };

  useEffect(load, []);

  // 点击外部关闭添加面板
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setActiveGroup(null);
        setSearchText("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const addRole = async (userId: string, role: string) => {
    setSaving(true);
    try {
      await fetchApi("/api/admin/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "添加角色失败");
    }
    setSaving(false);
    load();
  };

  const removeRole = async (userId: string, role: string, userName: string, groupLabel: string) => {
    if (!confirm(`确定将 ${userName} 从「${groupLabel}」组中移除？`)) return;
    setSaving(true);
    try {
      await fetchApi("/api/admin/permissions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "移除角色失败");
    }
    setSaving(false);
    load();
  };

  // 获取某组的成员
  const getGroupMembers = (groupKey: string): User[] =>
    users.filter((u) => u.roles.includes(groupKey));

  // 获取某组可添加的用户（不在该组的）
  const getAvailableUsers = (groupKey: string): User[] => {
    const members = new Set(getGroupMembers(groupKey).map((u) => u.id));
    return users.filter((u) => !members.has(u.id));
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">权限管理</h3>
        <span className="text-xs text-gray-400">共 {users.length} 名用户</span>
      </div>

      {/* 三个分组卡片 */}
      {GROUPS.map((group) => {
        const members = getGroupMembers(group.key);
        const available = getAvailableUsers(group.key);
        const filteredAvailable = searchText
          ? available.filter((u) => u.name.toLowerCase().includes(searchText.toLowerCase()))
          : available;
        const isOpen = activeGroup === group.key;

        return (
          <div key={group.key} className={`glass-card-static overflow-hidden ${group.borderColor}`}>
            {/* 卡片头部 */}
            <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${group.badgeColor}`}>
                  {group.label}
                </span>
                <span className="text-xs text-gray-400">
                  {members.length} 人
                </span>
              </div>
              <button
                onClick={() => {
                  setActiveGroup(isOpen ? null : group.key);
                  setSearchText("");
                }}
                className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                  isOpen ? "text-gray-600 bg-gray-100" : "text-indigo-600 bg-indigo-50"
                }`}
              >
                {isOpen ? "收起" : "+ 添加成员"}
              </button>
            </div>

            {/* 成员列表 */}
            <div className="px-5 py-3">
              {members.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-400">{group.emptyText}</div>
              ) : (
                <div className="space-y-1">
                  {members.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 group"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size="sm" avatarUrl={u.avatar ?? undefined} />
                        <span className="text-sm font-medium text-gray-800">{u.name}</span>
                        {u.department && (
                          <span className="text-xs text-gray-400">{u.department}</span>
                        )}
                        {/* 如果该用户同时在其他组，显示其他组标签 */}
                        <div className="flex gap-1">
                          {u.roles
                            .filter((r) => r !== group.key && r !== "member")
                            .map((r) => {
                              const g = GROUPS.find((gg) => gg.key === r);
                              return g ? (
                                <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded-full ${g.badgeColor}`}>
                                  {g.label}
                                </span>
                              ) : null;
                            })}
                        </div>
                      </div>
                      <button
                        onClick={() => removeRole(u.id, group.key, u.name, group.label)}
                        disabled={saving}
                        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-30"
                        title={`从${group.label}移除`}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 添加成员面板 */}
            {isOpen && (
              <div ref={addRef} className={`px-5 py-3 border-t border-gray-100 ${group.bgColor}`}>
                <div className="relative">
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="搜索要添加的员工..."
                    className="glass-input w-full text-sm"
                    autoFocus
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    {filteredAvailable.length} 人可选
                  </span>
                </div>
                {filteredAvailable.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                    {filteredAvailable.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => addRole(u.id, group.key)}
                        disabled={saving}
                        className="w-full flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white text-left transition-colors disabled:opacity-50"
                      >
                        <Avatar name={u.name} size="sm" avatarUrl={u.avatar ?? undefined} />
                        <span className="text-sm font-medium text-gray-800">{u.name}</span>
                        {u.department && (
                          <span className="text-xs text-gray-400">{u.department}</span>
                        )}
                        {/* 显示该用户当前已有的组 */}
                        <div className="ml-auto flex gap-1">
                          {u.roles
                            .filter((r) => r !== "member")
                            .map((r) => {
                              const g = GROUPS.find((gg) => gg.key === r);
                              return g ? (
                                <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded-full ${g.badgeColor}`}>
                                  {g.label}
                                </span>
                              ) : null;
                            })}
                        </div>
                        <span className="text-xs text-indigo-500 shrink-0">+ 添加</span>
                      </button>
                    ))}
                  </div>
                )}
                {filteredAvailable.length === 0 && searchText && (
                  <div className="py-4 text-center text-sm text-gray-400">没有匹配的员工</div>
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}
