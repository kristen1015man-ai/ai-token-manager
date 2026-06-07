"use client";

/** 配额管理页 — 个人限额 Tab 子组件 */
import { useState, useMemo } from "react";
import { fetchApi, ApiError } from "../../../../lib/fetcher";
import EmptyState from "@/components/EmptyState";
import Avatar from "@/components/Avatar";
import { type UserInfo, DEPT_COLORS, DEFAULT_DEPT } from "./quota-types";

interface PersonalQuotaTabProps {
  users: UserInfo[];
  departments: string[];
  onRefresh: () => void;
}

export default function PersonalQuotaTab({ users, departments, onRefresh }: PersonalQuotaTabProps) {
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

  const filteredUsers = useMemo(
    () => users.filter((u) => {
      if (deptFilter && u.department !== deptFilter) return false;
      if (searchText && !u.name.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    }),
    [users, deptFilter, searchText]
  );

  const hasEdits = Object.keys(editedQuotas).length > 0;

  const saveAllPersonal = async () => {
    setSaving(true);
    try {
      const promises = Object.entries(editedQuotas).map(([userId, limit]) =>
        fetchApi("/api/admin/quotas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "personal", targetId: userId, monthlyLimit: limit }),
        })
      );
      await Promise.all(promises);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "部分保存失败");
    }
    setSaving(false);
    setEditingId(null);
    setEditedQuotas({});
    onRefresh();
  };

  const saveBatch = async () => {
    setSaving(true);
    try {
      const targets = Array.from(selectedIds).map((id) => ({
        targetId: id,
        monthlyLimit: batchValue,
      }));
      await fetchApi("/api/admin/quotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "batch", targets }),
      });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "批量保存失败");
    }
    setSaving(false);
    setBatchMode(false);
    setSelectedIds(new Set());
    setShowBatchConfirm(false);
    onRefresh();
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
    <div className="glass-card-static overflow-hidden">
      {/* 筛选栏 + 操作按钮 */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-wrap gap-3 border-b border-gray-100"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-gray-800">员工个人限额</h3>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="glass-input text-sm !py-1.5 !px-3"
          >
            <option value="">全部部门</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <div className="relative">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索员工姓名..."
              className="glass-input text-sm !py-1.5 !pl-8 !pr-3 !w-44"
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
              <button
                onClick={exitBatchMode}
                className="px-3 py-1.5 text-sm rounded-xl font-medium transition-all duration-200 bg-gray-50 text-gray-500 border border-gray-100"
              >
                取消批量
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setShowBatchConfirm(true)}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm rounded-xl font-medium text-white disabled:opacity-50 transition-all duration-200 bg-amber-500 shadow-sm"
                >
                  统一设为 ¥{batchValue}（{selectedIds.size} 人）
                </button>
              )}
            </>
          ) : editingId ? (
            <>
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 text-sm rounded-xl font-medium transition-all duration-200 bg-gray-50 text-gray-500 border border-gray-100"
              >
                取消
              </button>
              <button
                onClick={saveAllPersonal}
                disabled={saving || !hasEdits}
                className="glass-btn text-sm !py-1.5 !px-4 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存修改"}
              </button>
            </>
          ) : (
            <button
              onClick={enterBatchMode}
              className="px-3 py-1.5 text-sm rounded-xl font-medium transition-all duration-200 bg-gray-50 text-gray-500 border border-gray-100"
            >
              批量修改
            </button>
          )}
        </div>
      </div>

      {/* 批量设置值 */}
      {batchMode && (
        <div
          className="px-6 py-3 flex items-center gap-3 bg-amber-50/30 border-b border-amber-200"
        >
          <span className="text-sm text-amber-700 font-medium">批量设为：</span>
          <span className="text-amber-600">¥</span>
          <input
            type="number"
            value={batchValue}
            onChange={(e) => setBatchValue(Number(e.target.value))}
            className="glass-input !px-2 !py-1 !w-24 border-amber-300"
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
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="glass-card p-6 max-w-sm w-full mx-4">
            <h4 className="font-semibold text-gray-800 mb-2">确认批量修改</h4>
            <p className="text-sm text-gray-600 mb-4">
              将 <strong>{selectedIds.size}</strong> 名员工的月度限额统一设为 <strong className="text-amber-600">¥{batchValue}</strong>？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowBatchConfirm(false)}
                className="px-4 py-2 text-sm rounded-xl font-medium transition-all duration-200 bg-gray-50 text-gray-500 border border-gray-100"
              >
                取消
              </button>
              <button
                onClick={saveBatch}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-xl font-medium text-white disabled:opacity-50 transition-all duration-200 bg-amber-500 shadow-sm"
              >
                {saving ? "保存中..." : "确认修改"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="glass-table">
          <thead>
            <tr>
              {batchMode && (
                <th className="text-center py-3 px-4 w-10"></th>
              )}
              <th className="text-left py-3 px-6">员工</th>
              <th className="text-left py-3 px-4">部门</th>
              <th className="text-right py-3 px-4">月度限额</th>
              {!batchMode && (
                <th className="text-center py-3 px-4 w-20">操作</th>
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
                  className={`transition-colors ${
                    isEditing ? "bg-indigo-50/30" :
                    isSelected ? "bg-amber-50/30" :
                    ""
                  }`}
                >
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

                  <td className="py-3 px-6">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size="md" avatarUrl={u.avatar ?? undefined} />
                      <p className="font-medium text-gray-800">{u.name}</p>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DEPT_COLORS[u.department || ""] || DEFAULT_DEPT}`}>
                      {u.department || "未分配"}
                    </span>
                  </td>

                  <td className="py-3 px-4 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-400">¥</span>
                        <input
                          type="number"
                          value={currentQuota}
                          onChange={(e) => updateQuota(u.id, Number(e.target.value))}
                          className="glass-input !px-2 !py-1 !w-20 text-right border-indigo-300"
                          autoFocus
                        />
                        <span className="text-gray-400 text-xs">/月</span>
                      </div>
                    ) : (
                      <span className="font-medium text-gray-800">¥{currentQuota}</span>
                    )}
                  </td>

                  {!batchMode && (
                    <td className="py-3 px-4 text-center">
                      {!isEditing ? (
                        <button
                          onClick={() => startEdit(u)}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all duration-200 text-indigo-600 bg-indigo-50"
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
      </div>

      {filteredUsers.length === 0 && (
        <EmptyState icon="" message="没有匹配的员工" />
      )}
    </div>
  );
}
