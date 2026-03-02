import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";

export default function UploadDocumentPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!file) {
      setError("PDF file is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("file", file);
      const { data } = await api.post("/documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      navigate(`/admin/documents/${data.id}/regions`);
    } catch (err) {
      setError(err.response?.data?.detail || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell title="Upload Document">
      <form onSubmit={submit} className="max-w-xl rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
        <label className="mb-1 block text-sm text-slate-300">Title</label>
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Contract Name"
        />
        <label className="mb-1 block text-sm text-slate-300">PDF file</label>
        <input className="mb-3 block w-full" type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
        <button className="rounded-lg bg-sky-700 px-4 py-2" disabled={loading} type="submit">
          {loading ? "Uploading..." : "Upload and Continue"}
        </button>
      </form>
    </AppShell>
  );
}
