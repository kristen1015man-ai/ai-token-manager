"use client";

import { useEffect, useState } from "react";

interface QuotaRule {
  id: string;
  scope: string;
  targetId: string;
  monthlyLimit: number;
}

interface UserInfo {
  id: string;
  name: string;
  department: string | null;
  monthlyQuota: number | null;
}

export default function QuotasPage() {
  const [rules, setRules] = useState<QuotaRule[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [tab, setTab] = useState<"company" | "department" | "personal">("company");
  const [companyLimit, setCompanyLimit] = useState(10000);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/quotas").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) {
        setRules(d.rules);
        setUsers(d.users);
        const cr = d.rules.find((r: QuotaRule) => r.scope === "company");
        if (cr) setCompanyLimit(cr.monthlyLimit);
      }
    });
  }, []);

  const saveCompany = async () => {
    setSaving(true);
    await fetch("/api/admin/quotas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "company", targetId: "all", monthlyLimit: companyLimit }),
    });
    setSaving(false);
    alert("公司限额已保存");
  };

  const saveUserQuota = async (userId: string, limit: number) => {
    await fetch("/api/admin/quotas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "personal", targetId: userId, monthlyLimit: limit }),
    });
  };

  return (
    <div className="space-y-6">
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

      {tab === "personal" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">员工个人限额</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left py-2 font-medium">姓名</th>
                <th className="text-left py-2 font-medium">部门</th>
                <th className="text-left py-2 font-medium">月度限额</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserQuotaRow key={u.id} user={u} onSave={saveUserQuota} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserQuotaRow({ user, onSave }: { user: UserInfo; onSave: (id: string, limit: number) => void }) {
  const [limit, setLimit] = useState(user.monthlyQuota ?? 200);

  return (
    <tr className="border-b border-gray-50">
      <td className="py-2 text-gray-800">{user.name}</td>
      <td className="py-2 text-gray-500">{user.department || "未分配"}</td>
      <td className="py-2">
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="px-2 py-1 border border-gray-200 rounded w-24 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <span className="text-gray-400 text-xs ml-1">元/月</span>
      </td>
      <td className="py-2 text-right">
        <button
          onClick={() => onSave(user.id, limit)}
          className="text-xs px-3 py-1 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100"
        >
          保存
        </button>
      </td>
    </tr>
  );
}
