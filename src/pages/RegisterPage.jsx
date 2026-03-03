import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import { extractApiErrorMessage } from "../lib/errorMessage";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "ADMIN" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/register", form);
      navigate("/login");
    } catch (err) {
      setError(extractApiErrorMessage(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h1 className="title-font mb-2 text-3xl text-sky-100">Create Account</h1>
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          placeholder="Password"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <select
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="ADMIN">Admin</option>
          <option value="SIGNER">Signer</option>
        </select>
        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
        <button className="w-full rounded-lg bg-sky-700 px-3 py-2 font-semibold hover:bg-sky-600" disabled={loading} type="submit">
          {loading ? "Creating..." : "Register"}
        </button>
        <p className="mt-4 text-sm text-slate-400">
          Already registered? <Link className="text-sky-300" to="/login">Login</Link>
        </p>
      </form>
    </div>
  );
}
