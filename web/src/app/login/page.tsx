export default function LoginPage() {
  const feishuAppId = process.env.NEXT_PUBLIC_FEISHU_APP_ID || "";
  const redirectUri = process.env.NEXT_PUBLIC_FEISHU_REDIRECT_URI || "";
  const feishuAuthUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${feishuAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=login`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-md text-center">
        <div className="mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">AI Token 管家</h1>
          <p className="text-gray-500 mt-2">公司级 AI API 用量管理平台</p>
        </div>

        <a
          href={feishuAuthUrl}
          className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-xl transition-colors text-lg"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.5 10.6c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1H5.6c-1.2 0-2.1-.9-2.1-2.1v-2.4zm8.5 0c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1h-2.4c-1.2 0-2.1-.9-2.1-2.1v-2.4zm-4.3-6c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1H9.8c-1.2 0-2.1-.9-2.1-2.1V4.6zm0 12c0-1.2.9-2.1 2.1-2.1h2.4c1.2 0 2.1.9 2.1 2.1v2.4c0 1.2-.9 2.1-2.1 2.1H9.8c-1.2 0-2.1-.9-2.1-2.1v-2.4z"/>
          </svg>
          飞书登录
        </a>

        <p className="text-xs text-gray-400 mt-6">
          使用公司飞书账号登录，首次登录自动注册
        </p>
      </div>
    </div>
  );
}
