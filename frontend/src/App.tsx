import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import AssociatesPage from "./pages/AssociatesPage";
import AssociateDetailPage from "./pages/AssociateDetailPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import ApplicationDetailPage from "./pages/ApplicationDetailPage";
import NewApplicationPage from "./pages/NewApplicationPage";
import CreditsPage from "./pages/CreditsPage";
import CreditDetailPage from "./pages/CreditDetailPage";
import AlertsPage from "./pages/AlertsPage";
import ReportsPage from "./pages/ReportsPage";
import ParametersPage from "./pages/ParametersPage";
import UsersPage from "./pages/UsersPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-center text-sm text-slate-500">Cargando sesión...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="asociados" element={<AssociatesPage />} />
        <Route path="asociados/:id" element={<AssociateDetailPage />} />
        <Route path="solicitudes" element={<ApplicationsPage />} />
        <Route path="solicitudes/nueva" element={<NewApplicationPage />} />
        <Route path="solicitudes/:id" element={<ApplicationDetailPage />} />
        <Route path="creditos" element={<CreditsPage />} />
        <Route path="creditos/:id" element={<CreditDetailPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="parametros" element={<ParametersPage />} />
        <Route path="usuarios" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
