import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { extractApiErrorMessage } from "../lib/errorMessage";

function denormalize(region, viewport) {
  return {
    id: region.id,
    x: region.x * viewport.width,
    y: region.y * viewport.height,
    width: region.width * viewport.width,
    height: region.height * viewport.height
  };
}

export default function RegionSelectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [document, setDocument] = useState(null);
  const [signers, setSigners] = useState([]);
  const [selectedSigner, setSelectedSigner] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [startPoint, setStartPoint] = useState(null);
  const [draftBox, setDraftBox] = useState(null);
  const [newRegions, setNewRegions] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [docRes, signerRes, fileRes] = await Promise.all([
          api.get(`/documents/${id}`),
          api.get("/users/signers"),
          api.get(`/documents/${id}/file`, { responseType: "blob" })
        ]);
        setDocument(docRes.data);
        setSigners(signerRes.data);
        setSelectedSigner(signerRes.data[0]?.id || "");
        setFileUrl(URL.createObjectURL(fileRes.data));
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load region setup"));
      }
    }
    load();
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [id]);

  const overlays = useMemo(() => {
    const existing = (document?.regions || [])
      .filter((region) => region.page_number === pageNumber)
      .map((region) => ({
        ...denormalize(region, viewport),
        className: "border-amber-500 bg-amber-500/20 pointer-events-none"
      }));
    const pending = newRegions
      .filter((region) => region.page_number === pageNumber)
      .map((region) => ({
        ...denormalize(region, viewport),
        className: "border-emerald-500 bg-emerald-500/20 pointer-events-none"
      }));
    const draft = draftBox
      ? [{ id: "draft", x: draftBox.x, y: draftBox.y, width: draftBox.width, height: draftBox.height, className: "border-sky-500 bg-sky-500/20 pointer-events-none" }]
      : [];
    return [...existing, ...pending, ...draft];
  }, [document, newRegions, pageNumber, viewport, draftBox]);

  const getPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  };

  const startDrag = (event) => {
    if (!selectedSigner) return;
    setStartPoint(getPoint(event));
    setDraftBox(null);
  };

  const moveDrag = (event) => {
    if (!startPoint) return;
    const current = getPoint(event);
    const x = Math.min(startPoint.x, current.x);
    const y = Math.min(startPoint.y, current.y);
    const width = Math.abs(startPoint.x - current.x);
    const height = Math.abs(startPoint.y - current.y);
    setDraftBox({ x, y, width, height });
  };

  const endDrag = () => {
    if (!draftBox || !selectedSigner || !viewport.width || !viewport.height) {
      setStartPoint(null);
      return;
    }
    if (draftBox.width < 10 || draftBox.height < 10) {
      setDraftBox(null);
      setStartPoint(null);
      return;
    }
    const normalized = {
      id: crypto.randomUUID(),
      page_number: pageNumber,
      x: draftBox.x / viewport.width,
      y: draftBox.y / viewport.height,
      width: draftBox.width / viewport.width,
      height: draftBox.height / viewport.height,
      assigned_to: selectedSigner
    };
    setNewRegions((prev) => [...prev, normalized]);
    setDraftBox(null);
    setStartPoint(null);
  };

  const submitRegions = async () => {
    if (!newRegions.length) {
      setError("Add at least one region");
      return;
    }
    try {
      await api.post(`/documents/${id}/regions`, { regions: newRegions.map(({ id: regionId, ...rest }) => rest) });
      navigate("/admin");
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to save regions"));
    }
  };

  return (
    <AppShell title="Region Selection">
      {error ? <p className="mb-3 text-red-400">{error}</p> : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm text-slate-300">
          Signer
          <select
            className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1"
            value={selectedSigner}
            onChange={(e) => setSelectedSigner(e.target.value)}
          >
            {signers.map((signer) => (
              <option key={signer.id} value={signer.id}>{signer.name}</option>
            ))}
          </select>
        </label>
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
        <button className="rounded bg-emerald-700 px-3 py-1 text-sm" onClick={submitRegions} type="button">
          Save Regions
        </button>
      </div>

      {fileUrl ? (
        <PdfPageCanvas
          fileUrl={fileUrl}
          pageNumber={pageNumber}
          onPageViewport={setViewport}
          overlays={overlays}
          onCanvasPointerDown={startDrag}
          onCanvasPointerMove={moveDrag}
          onCanvasPointerUp={endDrag}
        />
      ) : null}
      <p className="mt-3 text-sm text-slate-400">
        Drag on document to create signature box. Amber = existing. Green = new.
      </p>
    </AppShell>
  );
}
