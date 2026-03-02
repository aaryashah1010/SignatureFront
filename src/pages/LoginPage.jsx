import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuthStore } from "../store/authStore";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuth(data.access_token, data.user);
      navigate(data.user.role === "ADMIN" ? "/admin" : "/signer");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h1 className="title-font mb-2 text-3xl text-sky-100">Digital Signature Platform</h1>
        <p className="mb-4 text-sm text-slate-400">Sign in to continue your workflow.</p>
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
        <button className="w-full rounded-lg bg-sky-700 px-3 py-2 font-semibold hover:bg-sky-600" disabled={loading} type="submit">
          {loading ? "Signing in..." : "Login"}
        </button>
        <p className="mt-4 text-sm text-slate-400">
          No account? <Link className="text-sky-300" to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
