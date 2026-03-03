import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import { extractApiErrorMessage } from "../lib/errorMessage";

export default function AdminDashboardPage() {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");

  const downloadDocument = async (documentId) => {
    try {
      const response = await api.get(`/documents/${documentId}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = `signed_${documentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Download failed"));
    }
  };

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get("/documents/my");
        setDocuments(data);
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load documents"));
      }
    }
    load();
  }, []);

  return (
    <AppShell title="Admin Dashboard">
      <div className="mb-4 flex justify-end">
        <Link className="rounded-lg bg-sky-700 px-4 py-2 font-semibold hover:bg-sky-600" to="/admin/upload">
          Upload PDF
        </Link>
      </div>
      {error ? <p className="mb-4 text-red-400">{error}</p> : null}
      <div className="grid gap-3">
        {documents.map((doc) => (
          <article key={doc.id} className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-semibold text-sky-100">{doc.title}</h3>
                <p className="text-sm text-slate-400">Status: {doc.status} | Pages: {doc.total_pages}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className="rounded border border-slate-600 px-3 py-1 text-sm" to={`/admin/documents/${doc.id}/regions`}>
                  Regions
                </Link>
                <Link className="rounded border border-slate-600 px-3 py-1 text-sm" to={`/documents/${doc.id}/preview`}>
                  Preview
                </Link>
                {doc.status === "Completed" ? (
                  <button
                    className="rounded bg-emerald-700 px-3 py-1 text-sm"
                    onClick={() => downloadDocument(doc.id)}
                    type="button"
                  >
                    Download
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
