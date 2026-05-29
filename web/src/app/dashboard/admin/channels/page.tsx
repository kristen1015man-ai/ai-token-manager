"use client";

import { useEffect, useState } from "react";

interface Channel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string | string[];
  priority: number;
  status: string;
  createdAt: string;
}

const EMPTY = { name: "", baseUrl: "https://api.deepseek.com", apiKey: "", models: '["deepseek-chat"]', priority: 0, status: "active" };

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = () => {
    fetch("/api/admin/channels").then((r) => r.ok ? r.json() : null).then((d) => setChannels(d?.channels || []));
  };
  useEffect(load, []);

  const handleSubmit = async () => {
    const modelsArr = typeof form.models === "string" ? JSON.parse(form.models) : form.models;
    if (editingId) {
      await fetch("/api/admin/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...form, models: modelsArr }),
      });
    } else {
      await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, models: modelsArr }),
      });
    }
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    load();
  };

  const handleToggle = async (ch: Channel) => {
    await fetch("/api/admin/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ch.id, status: ch.status === "active" ? "disabled" : "active" }),
    });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此渠道吗？")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  };

  const startEdit = (ch: Channel) => {
    const modelsStr = Array.isArray(ch.models) ? JSON.stringify(ch.models) : ch.models;
    setForm({ ...ch, models: modelsStr, apiKey: "" }); // 清空 Key 防止显示脱敏值
    setEditingId(ch.id);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">上游 API 渠道</h3>
        <button
          onClick={() => { setForm(EMPTY); setEditingId(null); setShowForm(!showForm); }}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {showForm ? "取消" : "+ 添加渠道"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-indigo-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600 block mb-1">渠道名称</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Base URL</label>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">API Key {editingId && "(留空不修改)"}</label>
              <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} type="password"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">模型列表 (JSON 数组)</label>
              <input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">优先级 (数字越小越优先)</label>
              <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
            </div>
          </div>
          <button onClick={handleSubmit}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            {editingId ? "更新" : "添加"}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {channels.length === 0 ? (
          <div className="py-12 text-center text-gray-400">暂无渠道，请添加</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left py-2 font-medium">名称</th>
                <th className="text-left py-2 font-medium">Base URL</th>
                <th className="text-left py-2 font-medium">模型</th>
                <th className="text-center py-2 font-medium">优先级</th>
                <th className="text-center py-2 font-medium">状态</th>
                <th className="text-right py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => (
                <tr key={ch.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-800">{ch.name}</td>
                  <td className="py-2 text-gray-600 text-xs font-mono">{ch.baseUrl}</td>
                  <td className="py-2">
                    {(Array.isArray(ch.models) ? ch.models : JSON.parse(ch.models || "[]")).map((m: string) => (
                      <span key={m} className="inline-block px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs mr-1">{m}</span>
                    ))}
                  </td>
                  <td className="py-2 text-center text-gray-600">{ch.priority}</td>
                  <td className="py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${ch.status === "active" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                      {ch.status === "active" ? "启用" : "禁用"}
                    </span>
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button onClick={() => handleToggle(ch)} className="text-xs text-gray-500 hover:text-gray-700">
                      {ch.status === "active" ? "禁用" : "启用"}
                    </button>
                    <button onClick={() => startEdit(ch)} className="text-xs text-indigo-500 hover:text-indigo-700">编辑</button>
                    <button onClick={() => handleDelete(ch.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
