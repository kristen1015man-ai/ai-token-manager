"use client";

/** 全局概览页 — 渠道余额汇总 */
import { type BalanceSummary } from "./overview-types";

interface BalanceSummarySectionProps {
  balanceSummary: BalanceSummary;
}

export default function BalanceSummarySection({ balanceSummary }: BalanceSummarySectionProps) {
  const dangerAlerts = balanceSummary.alerts?.filter((a) => a.severity === "danger") || [];
  const warningAlerts = balanceSummary.alerts?.filter((a) => a.severity === "warning") || [];
  const cnyTotal = Number(balanceSummary.totals?.CNY ?? 0);
  const usdTotal = Number(balanceSummary.totals?.USD ?? 0);

  return (
    <>
      {/* ===== 余额告警横幅 ===== */}
      {dangerAlerts.length > 0 && (
        <div className="rounded-xl p-4 bg-red-50 border border-red-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔴</span>
            <span className="font-semibold text-red-700">渠道余额严重不足</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dangerAlerts.map((a) => (
              <span
                key={a.channelId}
                className="glass-badge bg-red-50 text-red-600"
              >
                {a.channelName}：{a.currency === "USD" ? "$" : "¥"}{a.balance != null ? Number(a.balance).toFixed(2) : "未知"}
              </span>
            ))}
          </div>
          <p className="text-xs text-red-500 mt-2">请及时充值，避免服务中断</p>
        </div>
      )}
      {warningAlerts.length > 0 && dangerAlerts.length === 0 && (
        <div className="rounded-xl p-4 bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🟡</span>
            <span className="font-semibold text-amber-700">部分渠道余额偏低</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {warningAlerts.map((a) => (
              <span
                key={a.channelId}
                className="glass-badge bg-amber-50 text-amber-700"
              >
                {a.channelName}：{a.currency === "USD" ? "$" : "¥"}{a.balance != null ? Number(a.balance).toFixed(2) : "未知"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ===== 渠道余额汇总卡片 ===== */}
      <div className="glass-card-static p-5">
        <h3 className="font-semibold text-gray-800 mb-4">渠道余额汇总</h3>

        {/* 汇总迷你卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {cnyTotal > 0 && (
            <div className="rounded-xl p-3 bg-green-50/50 border border-green-100">
              <p className="text-xs text-green-600 mb-1">CNY 总余额</p>
              <p className="text-xl font-bold text-green-700">¥{cnyTotal.toFixed(2)}</p>
            </div>
          )}
          {usdTotal > 0 && (
            <div className="rounded-xl p-3 bg-sky-50/50 border border-sky-100">
              <p className="text-xs text-sky-600 mb-1">USD 总余额</p>
              <p className="text-xl font-bold text-sky-700">${usdTotal.toFixed(2)}</p>
            </div>
          )}
          {balanceSummary.alerts.length > 0 && (
            <div className="rounded-xl p-3 bg-amber-50/50 border border-amber-100">
              <p className="text-xs text-amber-600 mb-1">低余额预警</p>
              <p className="text-xl font-bold text-amber-700">{balanceSummary.alerts.length} 个渠道</p>
            </div>
          )}
          <div className="rounded-xl p-3 bg-indigo-50/50 border border-indigo-100">
            <p className="text-xs text-indigo-600 mb-1">监控渠道数</p>
            <p className="text-xl font-bold text-indigo-700">{balanceSummary.channels.length}</p>
          </div>
        </div>

        {/* 余额表格 */}
        <div className="overflow-x-auto">
          <table className="glass-table">
            <thead>
              <tr>
                <th className="text-left">渠道</th>
                <th className="text-center">供应商</th>
                <th className="text-center">余额</th>
                <th className="text-center">状态</th>
                <th className="text-right">同步时间</th>
              </tr>
            </thead>
            <tbody>
              {balanceSummary.channels.map((ch) => {
                const alert = balanceSummary.alerts.find((a) => a.channelId === ch.id);
                const bal = ch.balance;
                const cur = ch.balanceCurrency || ch.currency || "CNY";
                const sym = cur === "USD" ? "$" : "¥";

                let statusLabel: string;
                let statusClass: string;
                if (bal == null) {
                  statusLabel = "未录入";
                  statusClass = "bg-gray-50 text-gray-400";
                } else if (alert?.severity === "danger") {
                  statusLabel = "严重不足";
                  statusClass = "bg-red-50 text-red-600";
                } else if (alert?.severity === "warning") {
                  statusLabel = "余额偏低";
                  statusClass = "bg-amber-50 text-amber-700";
                } else {
                  statusLabel = "正常";
                  statusClass = "bg-green-50 text-green-600";
                }

                return (
                  <tr key={ch.id}>
                    <td className="py-2 font-medium text-gray-800">{ch.name}</td>
                    <td className="py-2 text-center">
                      {ch.provider ? (
                        <span
                          className="glass-badge bg-purple-50 text-purple-600"
                        >
                          {ch.provider}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {bal != null ? (
                        <span className={`font-medium ${alert?.severity === "danger" ? "text-red-600" : alert?.severity === "warning" ? "text-amber-600" : "text-green-600"}`}>
                          {sym}{Number(bal).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      <span className={`glass-badge font-medium ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="py-2 text-right text-xs text-gray-400">
                      {ch.balanceSyncedAt ? new Date(ch.balanceSyncedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
