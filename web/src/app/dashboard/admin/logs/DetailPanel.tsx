/** 操作日志页 — 详情展开面板 */

export default function DetailPanel({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span className="text-gray-300">—</span>;

  // 特殊格式：角色变更
  if (detail.action === "add_role" || detail.action === "remove_role" || detail.action === "set_role") {
    const roleLabel = String(detail.role || "");
    const newRoles = Array.isArray(detail.newRoles) ? detail.newRoles.join(", ") : "";
    const actionLabel = detail.action === "add_role" ? "添加角色" : detail.action === "remove_role" ? "移除角色" : "设置角色";
    return (
      <div className="space-y-1 text-xs">
        <div><span className="text-gray-500">{actionLabel}:</span> <span className="font-medium text-gray-800">{roleLabel}</span></div>
        <div><span className="text-gray-500">当前角色:</span> <span className="text-gray-700">{newRoles}</span></div>
      </div>
    );
  }

  // 特殊格式：渠道更新（列出变更字段）
  if (detail.updatedFields) {
    const fields = Array.isArray(detail.updatedFields) ? detail.updatedFields : [];
    return (
      <div className="text-xs">
        <span className="text-gray-500">变更字段:</span>{" "}
        {fields.map((f, i) => (
          <span
            key={i}
            className="glass-badge mr-1 mb-1 bg-indigo-50 text-indigo-600"
          >
            {String(f)}
          </span>
        ))}
      </div>
    );
  }

  // 特殊格式：迁移结果
  const ch = detail.channels as Record<string, number> | undefined;
  const us = detail.users as Record<string, number> | undefined;
  if (ch || us) {
    return (
      <div className="space-y-1 text-xs">
        {ch && (
          <div>
            <span className="text-gray-500">渠道密钥:</span>{" "}
            加密 {ch.encrypted} / 总计 {ch.total}
          </div>
        )}
        {us && (
          <div>
            <span className="text-gray-500">用户密钥:</span>{" "}
            加密 {us.encrypted} / 总计 {us.total}
          </div>
        )}
      </div>
    );
  }

  // 通用 JSON 展开
  return (
    <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all max-h-40 overflow-auto">
      {JSON.stringify(detail, null, 2)}
    </pre>
  );
}
