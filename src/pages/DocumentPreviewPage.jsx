import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfDocumentScroller from "../components/PdfDocumentScroller";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { extractApiErrorMessage } from "../lib/errorMessage";
import { useAuthStore } from "../store/authStore";

export default function DocumentPreviewPage() {
  const { id } = useParams();
  const { token } = useAuthStore();
  const [document, setDocument] = useState(null);
  const [activePage, setActivePage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // `loading` only covers the (fast) metadata fetch. The actual PDF is streamed
  // and rendered by pdf.js afterwards, which is the slow part for a large file —
  // track that separately so the spinner stays up until the first page is
  // actually visible, not just until the JSON metadata arrives.
  const [firstPageReady, setFirstPageReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFirstPageReady(false);
    setError("");
    async function load() {
      try {
        const docRes = await api.get(`/documents/${id}`);
        if (!cancelled) setDocument(docRes.data);
      } catch (err) {
        if (!cancelled) setError(extractApiErrorMessage(err, "Failed to preview document"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const totalPages = document?.total_pages || 0;

  // Point pdf.js directly at the file endpoint instead of pre-downloading the
  // whole PDF as a blob first — pdf.js then streams it via HTTP range requests
  // and can render the first page as soon as enough bytes arrive, instead of
  // waiting for a large file to fully transfer before anything shows.
  const fileUrl = useMemo(() => {
    const base = api.defaults.baseURL || "";
    return `${base.replace(/\/$/, "")}/documents/${id}/file`;
  }, [id]);
  const pdfHttpHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token]
  );

  return (
    <AppShell title="Document Preview">
      {error ? <p className="mb-4 text-red-400">{error}</p> : null}

      {loading || (!loading && totalPages > 0 && !firstPageReady) ? (
        <div className="mb-4 flex items-center gap-3 text-sm text-slate-300">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-500" />
          {loading ? "Loading document…" : "Rendering document…"}
        </div>
      ) : null}

      {document ? (
        <div className="mb-4 text-sm text-slate-300">
          <p>Title: {document.title}</p>
          <p>Status: {document.status}</p>
          <p>Pages: {document.total_pages}</p>
        </div>
      ) : null}

      {!loading && totalPages > 0 ? (
        <PdfDocumentScroller
          totalPages={totalPages}
          activePage={activePage}
          onActivePageChange={setActivePage}
          renderPage={(n) => (
            <PdfPageCanvas
              fileUrl={fileUrl}
              pdfHttpHeaders={pdfHttpHeaders}
              pageNumber={n}
              onPageViewport={n === 1 ? () => setFirstPageReady(true) : undefined}
              overlays={[]}
              annotations={(document?.annotations || []).filter((a) => a.page_number === n)}
              readOnlyAnnotations
            />
          )}
        />
      ) : null}
    </AppShell>
  );
}
