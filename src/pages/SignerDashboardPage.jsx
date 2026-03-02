import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";

export default function SignerDashboardPage() {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get("/documents/pending");
        setDocuments(data);
      } catch (err) {
        setError(err.response?.data?.detail || "Failed to load pending documents");
      }
    }
    load();
  }, []);

  return (
    <AppShell title="Signer Dashboard">
      {error ? <p className="mb-4 text-red-400">{error}</p> : null}
      <div className="grid gap-3">
        {documents.map((doc) => (
          <article key={doc.id} className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
            <h3 className="font-semibold text-sky-100">{doc.title}</h3>
            <p className="mb-2 text-sm text-slate-400">Status: {doc.status}</p>
            <div className="flex gap-2">
              <Link className="rounded border border-slate-600 px-3 py-1 text-sm" to={`/documents/${doc.id}/preview`}>
                Preview
              </Link>
              <Link className="rounded bg-emerald-700 px-3 py-1 text-sm" to={`/signer/documents/${doc.id}/sign`}>
                Open Sign Page
              </Link>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
