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

  const signerRegions = useMemo(
    () =>
      (document?.regions || []).filter((region) => region.assigned_to === user.id),
    [document, user.id]
  );

  const overlays = useMemo(
    () =>
      signerRegions
        .filter((region) => region.page_number === pageNumber)
        .map((region) => ({
          ...denormalize(region, viewport),
          className: region.signed ? "border-slate-500 bg-slate-500/20 pointer-events-none" : "border-emerald-500 bg-emerald-500/20",
          onClick: region.signed ? undefined : () => setSelectedRegion(region)
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

  return (
    <AppShell title="Signing Page">
      {error ? <p className="mb-3 text-red-400">{error}</p> : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm text-slate-300">
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
        <button className="rounded border border-slate-700 px-3 py-1 text-sm" onClick={() => navigate("/signer")} type="button">
          Back
        </button>
      </div>
      {fileUrl ? <PdfPageCanvas fileUrl={fileUrl} pageNumber={pageNumber} onPageViewport={setViewport} overlays={overlays} /> : null}
      <p className="mt-3 text-sm text-slate-400">Only highlighted green boxes are signable. Signed boxes are locked.</p>

      {selectedRegion ? (
        <SignatureModal
          region={selectedRegion}
          onClose={() => setSelectedRegion(null)}
          onSubmit={submitSignature}
        />
      ) : null}
      {saving ? <p className="mt-2 text-sm text-slate-300">Applying signature...</p> : null}
    </AppShell>
  );
}
