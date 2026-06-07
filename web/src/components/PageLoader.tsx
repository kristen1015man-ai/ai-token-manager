/** 页面级加载占位组件 — 替代各页面重复的"加载中..."模板 */

interface PageLoaderProps {
  /** 自定义文案 */
  text?: string;
  /** 是否为全页占位（padding + animate-pulse）；false 则为内联 */
  fullPage?: boolean;
}

export default function PageLoader({ text = "加载中...", fullPage = true }: PageLoaderProps) {
  if (fullPage) {
    return (
      <div className="animate-pulse p-6 text-gray-400">{text}</div>
    );
  }
  return (
    <div className="py-16 text-center text-gray-400 animate-pulse">{text}</div>
  );
}
