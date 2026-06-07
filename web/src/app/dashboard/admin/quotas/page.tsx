"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchApi, ApiError } from "../../../../lib/fetcher";
import { type UserInfo } from "./quota-types";
import PersonalQuotaTab from "./PersonalQuotaTab";

export default function QuotasPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [tab, setTab] = useState<"company" | "personal">("company");
  const [companyLimit, setCompanyLimit] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadData = useCallback(() => {
    fetchApi<{ users: UserInfo[]; departments: string[]; companyLimit: number | null }>("/api/admin/quotas")
      .then((d) => {
        if (d) {
          setUsers(d.users || []);
          setDepartments(d.departments || []);
          if (d.companyLimit != null) setCompanyLimit(d.companyLimit);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const saveCompany = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetchApi("/api/admin/quotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "company", targetId: "all", monthlyLimit: companyLimit }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
      loadData();
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab 切换 */}
      <div className="flex gap-2">
        {(["company", "personal"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg transition-all duration-200 ${
              tab === t ? "font-medium bg-indigo-50 text-indigo-700" : "text-gray-500"
            }`}
          >
            {t === "company" ? "公司限额" : "个人限额"}
          </button>
        ))}
      </div>

      {/* 公司限额 */}
      {tab === "company" && (
        <div className="glass-card-static p-6">
          <h3 className="font-semibold text-gray-800 mb-4">全公司月度预算</h3>
          {companyLimit === null ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              加载中...
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-gray-600">¥</span>
              <input
                type="number"
                value={companyLimit}
                onChange={(e) => setCompanyLimit(Number(e.target.value))}
                className="glass-input w-40"
              />
              <span className="text-gray-500 text-sm">/ 月</span>
              <button
                onClick={saveCompany}
                disabled={saving}
                className="glass-btn text-sm disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              {saved && (
                <span className="text-sm text-emerald-600 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                  已保存
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 个人限额 */}
      {tab === "personal" && (
        <PersonalQuotaTab users={users} departments={departments} onRefresh={loadData} />
      )}
    </div>
  );
}
