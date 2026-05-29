import SummaryCards from "../../components/dashboard/summary-cards";
import QuotaProgress from "../../components/dashboard/quota-progress";
import UsageChart from "../../components/dashboard/usage-chart";
import UsageTable from "../../components/dashboard/usage-table";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <SummaryCards />
      <QuotaProgress />
      <UsageChart />
      <UsageTable />
    </div>
  );
}
