"use client";

import { useEffect, useState, useCallback } from "react";

interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
  department: string | null;
  monthlyQuota: number;
}

/* ===== 头像组件 ===== */
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500",
  "bg-amber-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  "bg-pink-500", "bg-sky-500",
];
function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="w-8 h-8 rounded-full object-cover ring-2 ring-white shadow" />;
  }
  return (
    <div className={`w-8 h-8 rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white text-xs font-semibold ring-2 ring-white shadow`}>
      {name.charAt(0)}
    </div>
  );
}

/* ===== 部门颜色 ===== */
const DEPT_COLORS: Record<string, string> = {
  "运营部": "bg-blue-50 text-blue-700",
  "经管部": "bg-violet-50 text-violet-700",
  "IT部": "bg-emerald-50 text-emerald-700",
  "产品部": "bg-amber-50 text-amber-700",
  "仓储物流部": "bg-cyan-50 text-cyan-700",
  "设计部": "bg-pink-50 text-pink-700",
  "品质部": "bg-teal-50 text-teal-700",
  "品牌部": "bg-rose-50 text-rose-700",
  "财务部": "bg-indigo-50 text-indigo-700",
  "人力行政部": "bg-orange-50 text-orange-700",
  "采购寻源部": "bg-lime-50 text-lime-700",
  "采购跟单部": "bg-sky-50 text-sky-700",
  "计划部": "bg-purple-50 text-purple-700",
};
const DEFAULT_DEPT = "bg-gray-50 text-gray-600";

export default function QuotasPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [tab, setTab] = useState<"company" | "personal">("company");
  const [companyLimit, setCompanyLimit] = useState(10000);
  const [saving, setSaving] = useState(false);

  // 筛选 & 搜索
  const [deptFilter, setDeptFilter] = useState("");
  const [searchText, setSearchText] = useState("");

  // 批量编辑
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchValue, setBatchValue] = useState<number>(200);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // 单条编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedQuotas, setEditedQuotas] = useState<Record<string, number>>({});

  const loadData = useCallback(() => {
    fetch("/api/admin/quotas").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) {
        setUsers(d.users || []);
        setDepartments(d.departments || []);
      }
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // 筛选后的用户列表
  const filteredUsers = users.filter((u) => {
    if (deptFilter && u.department !== deptFilter) return false;
    if (searchText && !u.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const saveCompany = async () => {
    setSaving(true);
    await fetch("/api/admin/quotas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "company", targetId: "all", monthlyLimit: companyLimit }),
    });
    setSaving(false);
    loadData();
  };

  const saveAllPersonal = async () => {
    setSaving(true);
    const promises = Object.entries(editedQuotas).map(([userId, limit]) =>
      fetch("/api/admin/quotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "personal", targetId: userId, monthlyLimit: limit }),
      })
    );
    await Promise.all(promises);
    setSaving(false);
    setEditingId(null);
    setEditedQuotas({});
    loadData();
  };

  // 批量保存
  const saveBatch = async () => {
    setSaving(true);
    const targets = Array.from(selectedIds).map((id) => ({
      targetId: id,
      monthlyLimit: batchValue,
    }));
    await fetch("/api/admin/quotas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "batch", targets }),
    });
    setSaving(false);
    setBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchConfirm(false);
    loadData();
  };

  const startEdit = (user: UserInfo) => {
    setEditingId(user.id);
    setEditedQuotas((prev) => ({ ...prev, [user.id]: user.monthlyQuota }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditedQuotas({});
  };

  const updateQuota = (userId: string, value: number) => {
    setEditedQuotas((prev) => ({ ...prev, [userId]: value }));
  };

  const hasEdits = Object.keys(editedQuotas).length > 0;

  // 批量选择操作
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredUsers.map((u) => u.id)));
    }
  };

  const enterBatchMode = () => {
    setBatchMode(true);
    setEditingId(null);
    setEditedQuotas({});
    setSelectedIds(new Set());
  };

  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchConfirm(false);
  };

  return (
    <div className="space-y-6">
      {/* Tab 切换 */}
      <div className="flex gap-2">
        {(["company", "personal"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              tab === t ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {t === "company" ? "公司限额" : "个人限额"}
          </button>
        ))}
      </div>

      {/* 公司限额 */}
      {tab === "company" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">全公司月度预算</h3>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">¥</span>
            <input
              type="number"
              value={companyLimit}
              onChange={(e) => setCompanyLimit(Number(e.target.value))}
              className="px-3 py-2 border border-gray-200 rounded-lg w-40 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <span className="text-gray-500 text-sm">/ 月</span>
            <button
              onClick={saveCompany}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}

      {/* 个人限额 */}
      {tab === "personal" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 筛选栏 + 操作按钮 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-semibold text-gray-800">员工个人限额</h3>
              {/* 部门筛选 */}
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="">全部部门</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {/* 搜索 */}
              <div className="relative">
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="搜索员工姓名..."
                  className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <span className="text-xs text-gray-400">{filteredUsers.length} / {users.length} 人</span>
            </div>

            <div className="flex items-center gap-2">
              {batchMode ? (
                <>
                  <button onClick={exitBatchMode} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    取消批量
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setShowBatchConfirm(true)}
                      disabled={saving}
                      className="px-4 py-1.5 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      统一设为 ¥{batchValue}（{selectedIds.size} 人）
                    </button>
                  )}
                </>
              ) : editingId ? (
                <>
                  <button onClick={cancelEdit} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    取消
                  </button>
                  <button
                    onClick={saveAllPersonal}
                    disabled={saving || !hasEdits}
                    className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? "保存中..." : "保存修改"}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={enterBatchMode} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    批量修改
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 批量设置值 */}
          {batchMode && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
              <span className="text-sm text-amber-700 font-medium">批量设为：</span>
              <span className="text-amber-600">¥</span>
              <input
                type="number"
                value={batchValue}
                onChange={(e) => setBatchValue(Number(e.target.value))}
                className="px-2 py-1 border border-amber-300 rounded w-24 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              <span className="text-amber-500 text-sm">/月</span>
              <label className="flex items-center gap-2 ml-4 text-sm text-amber-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredUsers.length && filteredUsers.length > 0}
                  onChange={selectAll}
                  className="rounded border-amber-300 text-amber-500 focus:ring-amber-200"
                />
                全选当前筛选结果
              </label>
            </div>
          )}

          {/* 批量确认弹窗 */}
          {showBatchConfirm && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
                <h4 className="font-semibold text-gray-800 mb-2">确认批量修改</h4>
                <p className="text-sm text-gray-600 mb-4">
                  将 <strong>{selectedIds.size}</strong> 名员工的月度限额统一设为 <strong className="text-amber-600">¥{batchValue}</strong>？
                </p>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setShowBatchConfirm(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    取消
                  </button>
                  <button onClick={saveBatch} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                    {saving ? "保存中..." : "确认修改"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                {batchMode && (
                  <th className="text-center py-3 px-4 w-10"></th>
                )}
                <th className="text-left py-3 px-6 font-medium text-gray-500">员工</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">部门</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">月度限额</th>
                {!batchMode && (
                  <th className="text-center py-3 px-4 font-medium text-gray-500 w-20">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const isEditing = editingId === u.id;
                const currentQuota = isEditing ? (editedQuotas[u.id] ?? u.monthlyQuota) : u.monthlyQuota;
                const isSelected = selectedIds.has(u.id);

                return (
                  <tr
                    key={u.id}
                    className={`border-b border-gray-50 transition-colors ${
                      isEditing ? "bg-indigo-50/50" :
                      isSelected ? "bg-amber-50/50" :
                      "hover:bg-gray-50/50"
                    }`}
                  >
                    {/* 批量选择复选框 */}
                    {batchMode && (
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(u.id)}
                          className="rounded border-gray-300 text-amber-500 focus:ring-amber-200"
                        />
                      </td>
                    )}

                    {/* 员工信息 */}
                    <td className="py-3 px-6">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} avatarUrl={u.avatar} />
                        <p className="font-medium text-gray-800">{u.name}</p>
                      </div>
                    </td>

                    {/* 部门 */}
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DEPT_COLORS[u.department || ""] || DEFAULT_DEPT}`}>
                        {u.department || "未分配"}
                      </span>
                    </td>

                    {/* 月度限额 */}
                    <td className="py-3 px-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-400">¥</span>
                          <input
                            type="number"
                            value={currentQuota}
                            onChange={(e) => updateQuota(u.id, Number(e.target.value))}
                            className="px-2 py-1 border border-indigo-300 rounded w-20 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            autoFocus
                          />
                          <span className="text-gray-400 text-xs">/月</span>
                        </div>
                      ) : (
                        <span className="font-medium text-gray-800">¥{currentQuota}</span>
                      )}
                    </td>

                    {/* 操作 */}
                    {!batchMode && (
                      <td className="py-3 px-4 text-center">
                        {!isEditing ? (
                          <button
                            onClick={() => startEdit(u)}
                            className="text-xs px-2.5 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50 font-medium"
                          >
                            编辑
                          </button>
                        ) : (
                          <span className="text-xs text-indigo-500">编辑中</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredUsers.length === 0 && (
            <div className="py-12 text-center text-gray-400">
              <p className="text-sm">没有匹配的员工</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
