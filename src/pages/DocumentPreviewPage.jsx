import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfDocumentScroller from "../components/PdfDocumentScroller";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { extractApiErrorMessage } from "../lib/errorMessage";

export default function DocumentPreviewPage() {
  const { id } = useParams();
  const [document, setDocument] = useState(null);
  const [fileUrl, setFileUrl] = useState("");
  const [activePage, setActivePage] = useState(1);
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

  const totalPages = document?.total_pages || 0;

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

      {fileUrl && totalPages > 0 ? (
        <PdfDocumentScroller
          totalPages={totalPages}
          activePage={activePage}
          onActivePageChange={setActivePage}
          renderPage={(n) => (
            <PdfPageCanvas
              fileUrl={fileUrl}
              pageNumber={n}
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
