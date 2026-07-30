import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { LoginPage } from "@/pages/LoginPage";
import { AppLayout } from "@/components/AppLayout";
import { ListingsPage } from "@/pages/ListingsPage";
import { ListingDetailPage } from "@/pages/ListingDetailPage";
import { RoutinesPage } from "@/pages/RoutinesPage";
import { StatusPage } from "@/pages/StatusPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      </div>
    );
  }
  if (!authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/listings" replace />} />
        <Route path="listings" element={<ListingsPage />} />
        <Route path="listings/:id" element={<ListingDetailPage />} />
        <Route path="routines" element={<RoutinesPage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="*" element={<Navigate to="/listings" replace />} />
      </Route>
    </Routes>
  );
}
