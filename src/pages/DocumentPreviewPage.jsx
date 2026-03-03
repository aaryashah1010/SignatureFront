import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { extractApiErrorMessage } from "../lib/errorMessage";

export default function DocumentPreviewPage() {
  const { id } = useParams();
  const [document, setDocument] = useState(null);
  const [fileUrl, setFileUrl] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [docRes, fileRes] = await Promise.all([
          api.get(`/documents/${id}`),
          api.get(`/documents/${id}/file`, { responseType: "blob" })
        ]);
        setDocument(docRes.data);
        setFileUrl(URL.createObjectURL(fileRes.data));
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to preview document"));
      }
    }
    load();
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [id]);

  return (
    <AppShell title="Document Preview">
      {error ? <p className="mb-4 text-red-400">{error}</p> : null}
      {document ? (
        <div className="mb-4 text-sm text-slate-300">
          <p>Title: {document.title}</p>
          <p>Status: {document.status}</p>
          <p>Pages: {document.total_pages}</p>
        </div>
      ) : null}
      <label className="mb-3 block text-sm text-slate-300">
        Page
        <select
          className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1"
          value={pageNumber}
          onChange={(e) => setPageNumber(Number(e.target.value))}
        >
          {Array.from({ length: document?.total_pages || 1 }).map((_, idx) => (
            <option key={idx + 1} value={idx + 1}>Page {idx + 1}</option>
          ))}
        </select>
      </label>
      {fileUrl ? <PdfPageCanvas fileUrl={fileUrl} pageNumber={pageNumber} overlays={[]} /> : null}
    </AppShell>
  );
}
