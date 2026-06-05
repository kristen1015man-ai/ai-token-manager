"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  name: string;
  role: string;
  department: string | null;
  departmentId: string | null;
  status: string;
  feishuId: string | null;
}

export default function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/permissions")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data) => {
        setUsers(data.users || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };
  useEffect(load, []);

  const updateRole = async (userId: string, role: string) => {
    await fetch("/api/admin/permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    load();
  };

  const admins = users.filter((u) => u.role === "admin");
  const deptHeads = users.filter((u) => u.role === "dept_head");
  const members = users.filter((u) => u.role === "member");

  const renderUser = (u: User) => (
    <div
      key={u.id}
      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-medium">
          {u.name.charAt(0)}
        </div>
        <div>
          <span className="text-sm font-medium text-gray-800">{u.name}</span>
          {u.department && (
            <span className="ml-2 text-xs text-gray-400">{u.department}</span>
          )}
        </div>
      </div>
      <select
        value={u.role}
        onChange={(e) => updateRole(u.id, e.target.value)}
        className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        <option value="admin">管理员</option>
        <option value="dept_head">部门负责人</option>
        <option value="member">普通成员</option>
      </select>
    </div>
  );

  if (loading) {
    return <div className="animate-pulse p-6 text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <h3 className="font-semibold text-gray-800">权限管理</h3>

      {/* 管理员 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-sm font-medium text-gray-600 mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600">
            管理员
          </span>
          <span className="text-xs text-gray-400">
            {admins.length} 人 · 拥有所有管理权限
          </span>
        </h4>
        <div className="space-y-1">{admins.map(renderUser)}</div>
      </div>

      {/* 部门负责人 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-sm font-medium text-gray-600 mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-600">
            部门负责人
          </span>
          <span className="text-xs text-gray-400">
            {deptHeads.length} 人 · 可查看本部门数据
          </span>
        </h4>
        {deptHeads.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-400">
            暂无部门负责人
          </div>
        ) : (
          <div className="space-y-1">{deptHeads.map(renderUser)}</div>
        )}
      </div>

      {/* 普通成员 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-sm font-medium text-gray-600 mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
            普通成员
          </span>
          <span className="text-xs text-gray-400">
            {members.length} 人 · 可查看个人用量
          </span>
        </h4>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {members.map(renderUser)}
        </div>
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <p>
          💡 管理员：拥有所有管理权限（渠道、价格、限额、权限等）
        </p>
        <p>
          💡 部门负责人：可查看本部门的用量和费用数据
        </p>
        <p>💡 普通成员：只能查看个人 API Key 和用量</p>
      </div>
    </div>
  );
}
