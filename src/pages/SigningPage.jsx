import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
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
  const [pageNumber, setPageNumber] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const load = async () => {
    try {
      const [docRes, fileRes] = await Promise.all([
        api.get(`/documents/${id}`),
        api.get(`/documents/${id}/file`, { responseType: "blob" })
      ]);
      setDocument(docRes.data);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFileUrl(URL.createObjectURL(fileRes.data));
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to load signing document"));
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

  const overlays = useMemo(
    () =>
      signerRegions
        .filter((r) => r.page_number === pageNumber)
        .map((r) => ({
          ...denormalize(r, viewport),
          className: r.signed
            ? "border-amber-500 bg-amber-500/20"
            : "border-emerald-500 bg-emerald-500/20",
          onClick: r.signed ? undefined : () => setSelectedRegion(r),
          onDoubleClick: r.signed ? () => setSelectedRegion(r) : undefined
        })),
    [signerRegions, pageNumber, viewport]
  );

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
  if (submitSuccess) {
    return (
      <AppShell title="Signing Complete">
        <div className="mx-auto max-w-md rounded-xl border border-emerald-700 bg-emerald-900/20 p-8 text-center">
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
            Document Submitted
          </h2>
          <p className="mb-6 text-sm text-slate-400">
            Your signatures have been submitted and the external system has been notified.
          </p>
          <button
            className="rounded bg-slate-700 px-5 py-2 text-sm text-slate-200 hover:bg-slate-600"
            onClick={() => navigate("/signer")}
            type="button"
          >
            Back to Dashboard
          </button>
        </div>
      </AppShell>
    );
  }

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

        <label className="text-sm text-slate-300">
          Page
          <select
            className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1"
            value={pageNumber}
            onChange={(e) => setPageNumber(Number(e.target.value))}
          >
            {Array.from({ length: document?.total_pages || 1 }).map((_, idx) => (
              <option key={idx + 1} value={idx + 1}>
                Page {idx + 1}
              </option>
            ))}
          </select>
        </label>

        <button
          className="rounded border border-slate-700 px-3 py-1 text-sm"
          onClick={() => navigate("/signer")}
          type="button"
        >
          Back
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

      {fileUrl ? (
        <PdfPageCanvas
          fileUrl={fileUrl}
          pageNumber={pageNumber}
          onPageViewport={setViewport}
          overlays={overlays}
        />
      ) : null}

      <p className="mt-3 text-sm text-slate-400">
        Green regions: click to sign.&nbsp; Amber regions: double-click to replace your signature.
      </p>

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
