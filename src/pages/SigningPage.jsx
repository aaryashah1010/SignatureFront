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
  const { user, token } = useAuthStore();
  const [document, setDocument] = useState(null);
  const [activePage, setActivePage] = useState(1);
  // Each rendered PdfPageCanvas reports its own pixel viewport; keep them per-page
  // so we denormalize region rectangles against the correct page size.
  const [pageViewports, setPageViewports] = useState({});
  const [loading, setLoading] = useState(true);
  // `loading` only covers the initial metadata fetch. The actual PDF is streamed
  // and rendered by pdf.js afterwards (and re-rendered after every sign, since
  // the file content changes) — track that separately so the spinner reappears
  // whenever a new version of the file is being rendered, not just on first open.
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [savedSignature, setSavedSignature] = useState(null);
  // #2 — one signature method locked for the whole document (draw | type | upload).
  const [signMethod, setSignMethod] = useState(null);
  const [methodPickerFor, setMethodPickerFor] = useState(null); // region awaiting a method choice
  // #3 — per-box prompt offering the remembered signature.
  const [savedPromptRegion, setSavedPromptRegion] = useState(null);
  // Standalone "View Signature" toolbar button — preview the remembered signature
  // without needing a target box (unlike the per-box prompt above).
  const [viewSignatureOpen, setViewSignatureOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  // Region the user just jumped to via "Next Sign" — gets a brief highlight pulse.
  const [highlightedRegionId, setHighlightedRegionId] = useState(null);
  // Regions signed THIS visit (cleared on remount, i.e. next time they open the
  // document) that haven't been through a final Submit yet — eligible to be
  // discarded if they close without finishing. Older, already-persisted work from
  // a prior visit is never touched by the discard flow.
  const [sessionSignedRegionIds, setSessionSignedRegionIds] = useState(() => new Set());
  const [discardPrompt, setDiscardPrompt] = useState(null); // { performClose }
  const [discarding, setDiscarding] = useState(false);
  const scrollerRef = useRef(null);

  const load = async () => {
    try {
      const docRes = await api.get(`/documents/${id}`);
      setDocument(docRes.data);
      return docRes.data;
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to load signing document"));
      return null;
    }
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [id]);

  // Point pdf.js directly at the file endpoint instead of pre-downloading the
  // whole PDF as a blob first — pdf.js then streams it via HTTP range requests
  // and can render the first page as soon as enough bytes arrive, instead of
  // waiting for a large file to fully transfer before anything shows. The `v`
  // param changes whenever the signed PDF actually changes (a new signature
  // burned in yields a new final_hash), forcing pdf.js to re-fetch instead of
  // reusing its cached copy of the pre-signature version.
  const fileUrl = useMemo(() => {
    if (!document) return "";
    const base = api.defaults.baseURL || "";
    const version = document.final_hash || document.status || "";
    return `${base.replace(/\/$/, "")}/documents/${id}/file?v=${encodeURIComponent(version)}`;
  }, [id, document?.final_hash, document?.status]);
  const pdfHttpHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token]
  );

  // Whenever the file actually changes (new fileUrl), the spinner should
  // reappear until the newly-rendered first page is visible again.
  useEffect(() => {
    setFirstPageReady(false);
  }, [fileUrl]);

  // Load the user's remembered signature. Called on mount AND after every sign, so a
  // signature the user just chose to "remember" becomes usable immediately on the
  // remaining boxes of THIS same document (not only on the next document).
  const refreshSavedSignature = async () => {
    try {
      const { data } = await api.get("/users/me/signature");
      if (data?.has_signature) setSavedSignature(data.signature);
    } catch {
      // ignore — remembered signature is optional
    }
  };

  useEffect(() => {
    refreshSavedSignature();
  }, []);

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
          onClick: r.signed ? undefined : () => handleBoxClick(r),
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

  const markSignedThisVisit = (regionId) => {
    setSessionSignedRegionIds((prev) => new Set(prev).add(regionId));
  };

  const submitSignature = async (signaturePayload) => {
    if (!selectedRegion) return;
    const regionId = selectedRegion.id;
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
      markSignedThisVisit(regionId);
      setSelectedRegion(null);
      await load();
      await refreshSavedSignature();
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to sign region"));
    } finally {
      setSaving(false);
    }
  };

  const unsignRegion = async (region) => {
    setSelectedRegion(null);
    setSaving(true);
    setError("");
    try {
      await api.post(`/documents/${id}/regions/${region.id}/unsign`);
      setSessionSignedRegionIds((prev) => {
        const next = new Set(prev);
        next.delete(region.id);
        return next;
      });
      await load();
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to remove signature"));
    } finally {
      setSaving(false);
    }
  };

  // Apply the remembered signature to ONE specific box — no bulk/apply-to-all
  // anywhere; the signer decides per box whether to reuse their saved signature.
  const applySavedToRegion = async (region) => {
    setSaving(true);
    setError("");
    try {
      await api.post(`/documents/${id}/sign`, {
        region_id: region.id,
        method: savedSignature.method,
        page_number: region.page_number,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        ...savedSignature,
        remember_signature: false
      });
      markSignedThisVisit(region.id);
      await load();
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to apply signature"));
    } finally {
      setSaving(false);
    }
  };

  // Clicking a box: if the user has a remembered signature, ask per-box whether to
  // reuse it or sign this one manually; otherwise go straight to manual signing.
  const handleBoxClick = (region) => {
    if (savedSignature) {
      setSavedPromptRegion(region);
    } else {
      startManualSign(region);
    }
  };

  // Manual signing: pick the document's signature method once (#2), then open the modal.
  const startManualSign = (region) => {
    if (!signMethod) {
      setMethodPickerFor(region);
    } else {
      setSelectedRegion(region);
    }
  };

  const chooseMethod = (method) => {
    setSignMethod(method);
    const region = methodPickerFor;
    setMethodPickerFor(null);
    if (region) setSelectedRegion(region);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/documents/${id}/submit`);
      setSessionSignedRegionIds(new Set()); // nothing left to warn about after a real submit
      setSubmitSuccess(true);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Submit failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Discard-unsaved-signatures-on-close ───────────────────────────────────
  // Only regions signed THIS visit are ever eligible — anything from an earlier
  // visit, or already covered by a completed Submit, is never touched.
  const handleAppShellCancel = (performClose) => {
    if (sessionSignedRegionIds.size === 0) {
      performClose();
      return;
    }
    setDiscardPrompt({ performClose });
  };

  const discardDraftAndClose = async () => {
    const performClose = discardPrompt?.performClose;
    setDiscarding(true);
    try {
      await api.post(`/documents/${id}/regions/discard-draft`, {
        region_ids: Array.from(sessionSignedRegionIds)
      });
    } catch {
      // Best-effort — still close as the user asked even if the cleanup call failed.
    } finally {
      setDiscarding(false);
      setDiscardPrompt(null);
      performClose?.();
    }
  };

  const keepAndClose = () => {
    const performClose = discardPrompt?.performClose;
    setDiscardPrompt(null);
    performClose?.();
  };

  // Native browser tab-close (the X on the tab, refresh, back). Browsers block
  // custom dialogs here — only their own generic "Leave site?" prompt appears —
  // so this is best-effort: if the user actually leaves, fire a fire-and-forget
  // discard for this visit's unsaved signatures. `fetch(keepalive)` (unlike
  // sendBeacon) supports the Authorization header and survives page teardown.
  useEffect(() => {
    if (sessionSignedRegionIds.size === 0) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePageHide = (event) => {
      // event.persisted means the page is going into the back/forward cache, not
      // actually being torn down (the user could come right back) — don't discard.
      if (event.persisted) return;
      const token = useAuthStore.getState().token;
      const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
      try {
        fetch(`${baseURL}/documents/${id}/regions/discard-draft`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ region_ids: Array.from(sessionSignedRegionIds) })
        });
      } catch {
        // best-effort only — nothing to recover from here
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [sessionSignedRegionIds, id]);

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
    <AppShell title="Signing Page" onCancel={handleAppShellCancel}>
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

        {savedSignature ? (
          <button
            className="rounded bg-teal-700 px-3 py-1 text-sm text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setViewSignatureOpen(true)}
            disabled={saving}
            type="button"
            title="View your remembered signature"
          >
            View Signature
          </button>
        ) : null}

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

      {loading || (!loading && totalPages > 0 && !firstPageReady) ? (
        <div className="mb-4 flex items-center gap-3 text-sm text-slate-300">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-500" />
          {loading ? "Loading document…" : "Rendering document…"}
        </div>
      ) : null}

      {!loading && fileUrl && totalPages > 0 ? (
        <PdfDocumentScroller
          ref={scrollerRef}
          totalPages={totalPages}
          activePage={activePage}
          onActivePageChange={setActivePage}
          renderPage={(n) => (
            <PdfPageCanvas
              fileUrl={fileUrl}
              pdfHttpHeaders={pdfHttpHeaders}
              pageNumber={n}
              onPageViewport={(vp) => {
                setViewportForPage(n, vp);
                if (n === 1) setFirstPageReady(true);
              }}
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
          onRemove={selectedRegion.signed ? () => unsignRegion(selectedRegion) : null}
          lockedMethod={signMethod}
        />
      ) : null}

      {/* #2 — choose the signature method once for the whole document */}
      {methodPickerFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center">
            <h2 className="mb-4 text-lg font-semibold text-sky-100">How do you want to sign this document?</h2>
            <p className="mb-5 text-sm text-slate-400">You can use only this method for every signature in this document.</p>
            <div className="flex justify-center gap-3">
              {["draw", "type", "upload"].map((m) => (
                <button
                  key={m}
                  className="rounded-lg bg-sky-700 px-4 py-2 text-sm capitalize hover:bg-sky-600"
                  onClick={() => chooseMethod(m)}
                  type="button"
                >
                  {m}
                </button>
              ))}
            </div>
            <button className="mt-5 text-xs text-slate-400 hover:text-slate-200" onClick={() => setMethodPickerFor(null)} type="button">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Per-box prompt: use the remembered signature for THIS box, or sign it manually.
          No bulk apply anywhere — every box is an individual choice. */}
      {savedPromptRegion ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center">
            <h2 className="mb-3 text-lg font-semibold text-sky-100">Use your saved signature for this box?</h2>
            <div className="mb-4 flex items-center justify-center rounded-lg border border-slate-700 bg-slate-100 p-3">
              {savedSignature?.method === "type" ? (
                <span className="text-2xl text-slate-900">{savedSignature.typed_name}</span>
              ) : (
                <img
                  src={savedSignature?.drawn_signature_base64 || savedSignature?.uploaded_signature_base64}
                  alt="Saved signature"
                  className="max-h-24"
                />
              )}
            </div>
            <div className="flex justify-center gap-3">
              <button
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm hover:bg-emerald-600 disabled:opacity-50"
                onClick={() => {
                  const region = savedPromptRegion;
                  setSavedPromptRegion(null);
                  applySavedToRegion(region);
                }}
                disabled={saving}
                type="button"
              >
                Use this signature
              </button>
              <button
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:border-sky-500"
                onClick={() => {
                  const region = savedPromptRegion;
                  setSavedPromptRegion(null);
                  startManualSign(region);
                }}
                type="button"
              >
                Sign it myself
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Standalone "View Signature" — pure preview of the remembered signature.
          No action here either; to use it, click a box and choose "Use this signature". */}
      {viewSignatureOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center">
            <h2 className="mb-3 text-lg font-semibold text-sky-100">Your Saved Signature</h2>
            <div className="mb-4 flex items-center justify-center rounded-lg border border-slate-700 bg-slate-100 p-3">
              {savedSignature?.method === "type" ? (
                <span className="text-2xl text-slate-900">{savedSignature.typed_name}</span>
              ) : (
                <img
                  src={savedSignature?.drawn_signature_base64 || savedSignature?.uploaded_signature_base64}
                  alt="Saved signature"
                  className="max-h-24"
                />
              )}
            </div>
            <p className="mb-5 text-sm text-slate-400">
              Click a box on the document to use this signature there, or sign it yourself.
            </p>
            <div className="flex justify-center gap-3">
              <button
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:border-sky-500"
                onClick={() => setViewSignatureOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Close-without-saving guard: only fires when something was signed this
          visit but never went through a final Submit. */}
      {discardPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center">
            <h2 className="mb-3 text-lg font-semibold text-sky-100">Close without submitting?</h2>
            <p className="mb-5 text-sm text-slate-400">
              You signed {sessionSignedRegionIds.size} region{sessionSignedRegionIds.size !== 1 ? "s" : ""} this visit
              but haven't submitted the document. Discard {sessionSignedRegionIds.size !== 1 ? "them" : "it"}, or keep
              and close anyway?
            </p>
            <div className="flex justify-center gap-3">
              <button
                className="rounded-lg border border-red-700 px-4 py-2 text-sm text-red-300 hover:bg-red-900/40 disabled:opacity-50"
                onClick={discardDraftAndClose}
                disabled={discarding}
                type="button"
              >
                {discarding ? "Discarding…" : "Discard & Close"}
              </button>
              <button
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm hover:bg-emerald-600 disabled:opacity-50"
                onClick={keepAndClose}
                disabled={discarding}
                type="button"
              >
                Keep & Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saving ? <p className="mt-2 text-sm text-slate-300">Applying signature…</p> : null}
    </AppShell>
  );
}
