/** 空状态占位组件 — 替代各页面重复的"暂无数据"模板 */

interface EmptyStateProps {
  /** 图标 emoji，如 "📊"、"📭"。传空字符串则不显示图标 */
  icon?: string;
  /** 提示文案，如 "暂无数据"、"暂无渠道，请添加" */
  message?: string;
  /** 额外 className（如需要包装容器样式） */
  className?: string;
}

export default function EmptyState({
  icon = "📭",
  message = "暂无数据",
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`py-16 text-center text-gray-400 ${className}`}>
      {icon && (
        <div className="text-4xl mb-3">{icon}</div>
      )}
      <p>{message}</p>
    </div>
  );
}
