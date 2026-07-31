import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { NewRequestPage } from "./pages/NewRequestPage";
import { MyRequestsPage } from "./pages/MyRequestsPage";
import { RequestDetailPage } from "./pages/RequestDetailPage";
import { InboxPage } from "./pages/InboxPage";
import { ForecastPage } from "./pages/ForecastPage";
import { Step5DashboardPage } from "./pages/Step5DashboardPage";
import { AdminConsolePage } from "./pages/admin/AdminConsolePage";
import { ManpowerDashboardPage } from "./pages/manpower/ManpowerDashboardPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="requests/new" element={<NewRequestPage />} />
        <Route path="requests/mine" element={<MyRequestsPage />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="forecast" element={<ForecastPage />} />
        <Route path="step5" element={<Step5DashboardPage />} />
        <Route path="admin" element={<AdminConsolePage />} />
        <Route path="manpower" element={<ManpowerDashboardPage />} />
      </Route>
    </Routes>
  );
}
