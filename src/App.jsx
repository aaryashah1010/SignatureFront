import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import DocumentPreviewPage from "./pages/DocumentPreviewPage";
import LaunchPage from "./pages/LaunchPage";
import LoginPage from "./pages/LoginPage";
import RegionSelectionPage from "./pages/RegionSelectionPage";
import RegisterPage from "./pages/RegisterPage";
import SignerDashboardPage from "./pages/SignerDashboardPage";
import SigningPage from "./pages/SigningPage";
import UploadDocumentPage from "./pages/UploadDocumentPage";
import { useAuthStore } from "./store/authStore";

export default function App() {
  const { user } = useAuthStore();

  return (
    <Routes>
      {/* Public integration entry point – no auth required */}
      <Route path="/lof" element={<LaunchPage />} />
      <Route path="/launch" element={<LaunchPage />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute role="ADMIN">
            <AdminDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/upload"
        element={
          <ProtectedRoute role="ADMIN">
            <UploadDocumentPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/documents/:id/regions"
        element={
          <ProtectedRoute role="ADMIN">
            <RegionSelectionPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/signer"
        element={
          <ProtectedRoute role="SIGNER">
            <SignerDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/signer/documents/:id/sign"
        element={
          <ProtectedRoute role="SIGNER">
            <SigningPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents/:id/preview"
        element={
          <ProtectedRoute>
            <DocumentPreviewPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="*"
        element={
          user ? (
            <Navigate to={user.role === "ADMIN" ? "/admin" : "/signer"} replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
