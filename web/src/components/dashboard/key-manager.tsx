"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";

export default function KeyManager() {
  const [keyData, setKeyData] = useState<{
    apiKey?: string;
    maskedKey: string;
    configCommand?: string;
    proxyUrl?: string;
  } | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<{ maskedKey: string; proxyUrl: string }>("/api/user/key")
      .then((d) => { setKeyData(d); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "加载失败"));
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const handleReset = async () => {
    if (!confirm("确定要重置 API Key 吗？旧 Key 将立即失效。")) return;
    setResetting(true);
    setError(null);
    try {
      const data = await fetchApi<{ apiKey: string; maskedKey: string; configCommand: string; proxyUrl: string }>("/api/user/key", {
        method: "POST",
      });
      setKeyData(data);
      setShowFull(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重置失败，请稍后重试");
    } finally {
      setResetting(false);
    }
  };

  if (!keyData) {
    if (error) {
      return (
        <div className="glass-card-static p-4 text-sm text-red-600 bg-red-50/70">
          加载失败：{error}
        </div>
      );
    }
    return <div className="animate-pulse p-6">加载中...</div>;
  }

  const hasFullKey = !!keyData.apiKey;

  return (
    <div className="space-y-6">
      {error && (
        <div className="glass-card-static p-3 text-sm text-red-600 bg-red-50/70">
          {error}
        </div>
      )}

      {/* API Key 展示 */}
      <div className="glass-card-static p-6">
        <h3 className="font-semibold text-gray-800 mb-4">你的 API Key</h3>
        <div
          className="rounded-xl p-4 font-mono text-sm flex items-center justify-between bg-indigo-50/30 border border-indigo-100"
        >
          <span className="break-all text-gray-700">
            {hasFullKey && showFull
              ? keyData.apiKey
              : keyData.maskedKey}
          </span>
          <div className="flex gap-2 shrink-0 ml-4">
            {hasFullKey && (
              <button
                onClick={() => setShowFull(!showFull)}
                className="glass-badge cursor-pointer hover:bg-white/50 transition-colors"
              >
                {showFull ? "隐藏" : "显示"}
              </button>
            )}
            <button
              onClick={() => copyToClipboard(keyData.apiKey || keyData.maskedKey, "key")}
              className="text-xs px-3 py-1 rounded-lg transition-all duration-200 bg-indigo-50/50 text-indigo-600 hover:bg-indigo-100/60"
            >
              {copied === "key" ? "✓ 已复制" : hasFullKey ? "复制 Key" : "复制"}
            </button>
          </div>
        </div>
        {!hasFullKey && (
          <p className="text-xs text-gray-400 mt-2">为安全起见，完整 Key 不再展示。如需查看请重置 Key。</p>
        )}
      </div>

      {/* 环境变量配置 */}
      {keyData.configCommand && (
        <div className="glass-card-static p-6">
          <h3 className="font-semibold text-gray-800 mb-4">环境变量配置</h3>
          <p className="text-sm text-gray-500 mb-3">复制以下命令，粘贴到终端执行即可：</p>
          <div
            className="rounded-xl p-4 font-mono text-sm relative"
            style={{
              background: "rgba(15, 12, 41, 0.85)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(99, 102, 241, 0.15)",
              color: "#6ee7b7",
            }}
          >
            <pre className="whitespace-pre-wrap">{keyData.configCommand}</pre>
            <button
              onClick={() => copyToClipboard(keyData.configCommand!, "config")}
              className="absolute top-3 right-3 text-xs px-3 py-1 rounded-lg transition-colors"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                color: "rgba(255, 255, 255, 0.6)",
                border: "1px solid rgba(255, 255, 255, 0.10)",
              }}
            >
              {copied === "config" ? "✓ 已复制" : "复制"}
            </button>
          </div>
        </div>
      )}

      {/* 重置 Key */}
      <div className="glass-card-static p-6 border-red-200/40">
        <h3 className="font-semibold text-red-600 mb-2">重置 API Key</h3>
        <p className="text-sm text-gray-500 mb-4">
          重置后旧 Key 立即失效，所有使用旧 Key 的工具都需要更新配置。
        </p>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="px-4 py-2 text-sm rounded-xl font-medium transition-all duration-200 disabled:opacity-50 bg-red-50/50 text-red-600 border border-red-200"
        >
          {resetting ? "重置中..." : "重置 Key"}
        </button>
      </div>
    </div>
  );
}
