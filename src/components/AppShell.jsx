import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function AppShell({ title, children }) {
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  return (
    <div className="min-h-screen px-4 py-6 md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-glow md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="title-font text-2xl text-sky-200">{title}</h1>
            <p className="text-sm text-slate-400">{user?.name} ({user?.role})</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-sky-500"
              to={user?.role === "ADMIN" ? "/admin" : "/signer"}
            >
              Dashboard
            </Link>
            <button
              className="rounded-lg bg-sky-700 px-3 py-2 text-sm hover:bg-sky-600"
              onClick={handleLogout}
              type="button"
            >
              Logout
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
