export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* 欢迎卡片 */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-8 text-white">
        <h2 className="text-2xl font-bold mb-2">👋 欢迎使用 AI Token 管家</h2>
        <p className="text-indigo-100 text-lg">
          查看你的 API 用量、管理 API Key，一切尽在掌握。
        </p>
      </div>

      {/* 快速入门 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">🔑 获取你的 API Key</h3>
          <p className="text-sm text-gray-500 mb-4">
            复制你的专属 Key，配置到环境变量即可开始使用。
          </p>
          <a
            href="/dashboard/key"
            className="inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            前往 API Key 页面 →
          </a>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">📊 使用指南</h3>
          <div className="text-sm text-gray-500 space-y-2">
            <p>1. 复制 API Key 和配置命令</p>
            <p>2. 设置环境变量：</p>
            <code className="block bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-700">
              export OPENAI_API_KEY=sk-emp-xxx{"\n"}
              export OPENAI_BASE_URL=https://ai.yourcompany.com/v1
            </code>
            <p>3. 所有兼容 OpenAI 的工具自动走公司代理</p>
          </div>
        </div>
      </div>

      {/* 占位：用量概览将在 Phase 3 实现 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
        📈 用量概览图表将在下一阶段实现
      </div>
    </div>
  );
}
