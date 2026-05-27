import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfDocumentScroller from "../components/PdfDocumentScroller";
import PdfPageCanvas from "../components/PdfPageCanvas";
import SignatureModal from "../components/SignatureModal";
import { extractApiErrorMessage } from "../lib/errorMessage";
import { useAuthStore } from "../store/authStore";

function denormalize(region, viewport) {
  return {
    id: region.id,
    x: region.x * viewport.width,
    y: region.y * viewport.height,
    width: region.width * viewport.width,
    height: region.height * viewport.height
  };
}

export default function SigningPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [document, setDocument] = useState(null);
  const [fileUrl, setFileUrl] = useState("");
  const [activePage, setActivePage] = useState(1);
  // Each rendered PdfPageCanvas reports its own pixel viewport; keep them per-page
  // so we denormalize region rectangles against the correct page size.
  const [pageViewports, setPageViewports] = useState({});
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  // Region the user just jumped to via "Next Sign" — gets a brief highlight pulse.
  const [highlightedRegionId, setHighlightedRegionId] = useState(null);
  const scrollerRef = useRef(null);

  const load = async () => {
    try {
      const [docRes, fileRes] = await Promise.all([
        api.get(`/documents/${id}`),
        api.get(`/documents/${id}/file`, { responseType: "blob" })
      ]);
      setDocument(docRes.data);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFileUrl(URL.createObjectURL(fileRes.data));
      return docRes.data;
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to load signing document"));
      return null;
    }
  };

  useEffect(() => {
    load();
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [id]);

  // Regions assigned to the current signer.
  const signerRegions = useMemo(
    () => (document?.regions || []).filter((r) => r.assigned_to === user.id),
    [document, user.id]
  );

  // Progress counters.
  const assignedTotal = signerRegions.length;
  const assignedSigned = signerRegions.filter((r) => r.signed).length;
  const canSubmit = assignedTotal > 0 && assignedSigned === assignedTotal;

  const setViewportForPage = useCallback((n, vp) => {
    setPageViewports((prev) => {
      const existing = prev[n];
      if (existing && existing.width === vp.width && existing.height === vp.height) {
        return prev;
      }
      return { ...prev, [n]: vp };
    });
  }, []);

  const buildOverlaysForPage = (n) => {
    const vp = pageViewports[n];
    if (!vp) return [];
    return signerRegions
      .filter((r) => r.page_number === n)
      .map((r) => {
        const baseClass = r.signed
          ? "border-amber-500 bg-amber-500/20"
          : "border-emerald-500 bg-emerald-500/20";
        // Bright ring + pulse + extra shadow so the targeted region is impossible
        // to miss after Next Sign jumps to it.
        const pulseClass =
          r.id === highlightedRegionId
            ? " ring-8 ring-cyan-400 shadow-[0_0_30px_8px_rgba(34,211,238,0.6)] animate-pulse z-10"
            : "";
        return {
          ...denormalize(r, vp),
          className: baseClass + pulseClass,
          onClick: r.signed ? undefined : () => setSelectedRegion(r),
          onDoubleClick: r.signed ? () => setSelectedRegion(r) : undefined
        };
      });
  };

  // ── "Next Sign" jump ──────────────────────────────────────────────────────
  // Always pick the top-most unsigned region in reading order (page, y, x),
  // regardless of where the user is currently scrolled.
  const orderRegions = (regions) =>
    [...regions]
      // Treat anything other than strict `true` as unsigned — defensive against
      // the API ever returning falsy stand-ins like null / undefined / 0.
      .filter((r) => r.signed !== true)
      .sort((a, b) => {
        if (a.page_number !== b.page_number) return a.page_number - b.page_number;
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });

  const unsignedRegionsOrdered = useMemo(() => orderRegions(signerRegions), [signerRegions]);

  // Approximate height of the "Page N" label that sits above each canvas inside
  // the scroller — used to offset the region's Y when computing scroll target.
  const PAGE_LABEL_HEIGHT_PX = 24;

  const jumpToRegion = (region) => {
    if (!region) return;
    setActivePage(region.page_number);
    const vp = pageViewports[region.page_number];
    // Center the region vertically in the viewport when we know the page's pixel size.
    const centerOnPagePx = vp
      ? PAGE_LABEL_HEIGHT_PX + region.y * vp.height + (region.height * vp.height) / 2
      : null;
    scrollerRef.current?.scrollToPage(region.page_number, centerOnPagePx);
    setHighlightedRegionId(region.id);
    setTimeout(() => {
      setHighlightedRegionId((current) => (current === region.id ? null : current));
    }, 3500);
  };

  const jumpToNextSign = () => jumpToRegion(unsignedRegionsOrdered[0]);

  const submitSignature = async (signaturePayload) => {
    if (!selectedRegion) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/documents/${id}/sign`, {
        region_id: selectedRegion.id,
        method: signaturePayload.method,
        page_number: selectedRegion.page_number,
        x: selectedRegion.x,
        y: selectedRegion.y,
        width: selectedRegion.width,
        height: selectedRegion.height,
        ...signaturePayload
      });
      setSelectedRegion(null);
      await load();
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to sign region"));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/documents/${id}/submit`);
      setSubmitSuccess(true);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Submit failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Submission success screen ─────────────────────────────────────────────
  // Integration flow: signer reached this via a launch URL; they shouldn't see
  // the dashboard. Briefly show the thank-you, then try to close the tab.
  // window.close() only works if the tab was opened via window.open(); when
  // blocked, the on-screen message tells the user to close it manually.
  useEffect(() => {
    if (!submitSuccess) return;
    const timer = setTimeout(() => window.close(), 1500);
    return () => clearTimeout(timer);
  }, [submitSuccess]);

  if (submitSuccess) {
    return (
      <AppShell title="Signing Complete" hideHeader>
        <div className="mx-auto mt-24 max-w-md rounded-xl border border-emerald-700 bg-emerald-900/20 p-8 text-center">
          <svg
            className="mx-auto mb-4 h-16 w-16 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="mb-2 text-xl font-semibold text-emerald-300">
            Thank you!
          </h2>
          <p className="text-sm text-slate-400">
            Your signatures have been submitted. You may close this tab now.
          </p>
        </div>
      </AppShell>
    );
  }

  const totalPages = document?.total_pages || 0;

  return (
    <AppShell title="Signing Page">
      {error ? <p className="mb-3 text-red-400">{error}</p> : null}

      {/* ── Progress counter + controls ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Signing progress pill */}
        {assignedTotal > 0 && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              canSubmit
                ? "bg-emerald-800 text-emerald-200"
                : "bg-slate-700 text-slate-300"
            }`}
          >
            Signed {assignedSigned} of {assignedTotal} required region
            {assignedTotal !== 1 ? "s" : ""}
          </span>
        )}

        <button
          className="rounded border border-slate-700 px-3 py-1 text-sm"
          onClick={() => navigate("/signer")}
          type="button"
        >
          Back
        </button>

        <button
          className="rounded bg-cyan-700 px-3 py-1 text-sm text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={jumpToNextSign}
          disabled={unsignedRegionsOrdered.length === 0}
          type="button"
          title={
            unsignedRegionsOrdered.length
              ? `Jump to the next region you still need to sign (${unsignedRegionsOrdered.length} left)`
              : "All your regions are signed"
          }
        >
          Next Sign
          {unsignedRegionsOrdered.length > 0 ? ` (${unsignedRegionsOrdered.length})` : ""}
        </button>

        {/* Submit button – enabled only when all regions are signed */}
        <button
          className={`ml-auto rounded px-4 py-1.5 text-sm font-medium transition-colors ${
            canSubmit
              ? "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700"
              : "cursor-not-allowed bg-slate-700 text-slate-500"
          }`}
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          title={
            canSubmit
              ? "Submit signed document to the external system"
              : `Sign all ${assignedTotal} region${assignedTotal !== 1 ? "s" : ""} before submitting`
          }
          type="button"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>

      {fileUrl && totalPages > 0 ? (
        <PdfDocumentScroller
          ref={scrollerRef}
          totalPages={totalPages}
          activePage={activePage}
          onActivePageChange={setActivePage}
          renderPage={(n) => (
            <PdfPageCanvas
              fileUrl={fileUrl}
              pageNumber={n}
              onPageViewport={(vp) => setViewportForPage(n, vp)}
              overlays={buildOverlaysForPage(n)}
              annotations={(document?.annotations || []).filter((a) => a.page_number === n)}
              readOnlyAnnotations
            />
          )}
        />
      ) : null}

      <p className="mt-3 text-sm text-slate-400">
        Green regions: click to sign.&nbsp; Amber regions: double-click to replace your signature.
        Scroll through the pages or use the "Go to page" box above to jump.
      </p>
      {document?.annotations?.length ? (
        <p className="mt-1 text-xs text-slate-500">
          Highlights, drawings and comments above are notes from the admin to guide you.
        </p>
      ) : null}

      {selectedRegion ? (
        <SignatureModal
          region={selectedRegion}
          onClose={() => setSelectedRegion(null)}
          onSubmit={submitSignature}
        />
      ) : null}

      {saving ? <p className="mt-2 text-sm text-slate-300">Applying signature…</p> : null}
    </AppShell>
  );
}
