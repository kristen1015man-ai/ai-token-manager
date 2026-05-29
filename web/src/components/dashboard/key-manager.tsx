"use client";

import { useEffect, useState } from "react";

export default function KeyManager() {
  const [keyData, setKeyData] = useState<{
    apiKey: string;
    maskedKey: string;
    configCommand: string;
  } | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetch("/api/user/key")
      .then((r) => (r.ok ? r.json() : null))
      .then(setKeyData);
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const handleReset = async () => {
    if (!confirm("确定要重置 API Key 吗？旧 Key 将立即失效。")) return;
    setResetting(true);
    const res = await fetch("/api/user/key", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setKeyData(data);
      setShowFull(false);
    }
    setResetting(false);
  };

  if (!keyData) {
    return <div className="animate-pulse p-6">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* API Key 展示 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">你的 API Key</h3>
        <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
          <span className="break-all">{showFull ? keyData.apiKey : keyData.maskedKey}</span>
          <div className="flex gap-2 shrink-0 ml-4">
            <button
              onClick={() => setShowFull(!showFull)}
              className="text-xs px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600"
            >
              {showFull ? "隐藏" : "显示"}
            </button>
            <button
              onClick={() => copyToClipboard(keyData.apiKey, "key")}
              className="text-xs px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
            >
              {copied === "key" ? "✓ 已复制" : "复制 Key"}
            </button>
          </div>
        </div>
      </div>

      {/* 环境变量配置 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">环境变量配置</h3>
        <p className="text-sm text-gray-500 mb-3">复制以下命令，粘贴到终端执行即可：</p>
        <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-sm relative">
          <pre className="whitespace-pre-wrap">{keyData.configCommand}</pre>
          <button
            onClick={() => copyToClipboard(keyData.configCommand, "config")}
            className="absolute top-3 right-3 text-xs px-3 py-1 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600"
          >
            {copied === "config" ? "✓ 已复制" : "复制"}
          </button>
        </div>
      </div>

      {/* 重置 Key */}
      <div className="bg-white rounded-xl border border-red-100 p-6">
        <h3 className="font-semibold text-red-600 mb-2">重置 API Key</h3>
        <p className="text-sm text-gray-500 mb-4">
          重置后旧 Key 立即失效，所有使用旧 Key 的工具都需要更新配置。
        </p>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="px-4 py-2 text-sm rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
        >
          {resetting ? "重置中..." : "重置 Key"}
        </button>
      </div>
    </div>
  );
}
