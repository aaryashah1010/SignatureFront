import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfDocumentScroller from "../components/PdfDocumentScroller";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { extractApiErrorMessage } from "../lib/errorMessage";

const TOOLS = [
  { value: "box", label: "Signature Box", hint: "Drag to mark where the signer must sign." },
  { value: "highlight", label: "Highlight", hint: "Drag to highlight an area." },
  { value: "draw", label: "Draw", hint: "Press and drag to draw freely. Release to start a new stroke." },
  { value: "text", label: "Comment", hint: "Drag to place a comment box, then type your note." }
];

const COLORS = ["#fde047", "#f87171", "#34d399", "#60a5fa", "#a78bfa", "#1f2937"];

function denormalize(region, viewport) {
  return {
    id: region.id,
    x: region.x * viewport.width,
    y: region.y * viewport.height,
    width: region.width * viewport.width,
    height: region.height * viewport.height
  };
}

function strokeBounds(strokes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export default function RegionSelectionPage() {
  const { id } = useParams();
  const [document, setDocument] = useState(null);
  const [signers, setSigners] = useState([]);
  const [selectedSigner, setSelectedSigner] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [activePage, setActivePage] = useState(1);
  // One viewport entry per rendered page (each PdfPageCanvas reports its size).
  const [pageViewports, setPageViewports] = useState({});

  // Drag state is tied to the page the drag started on. Highlight/text/box use
  // (startPoint + draftBox); draw uses (drawStrokes + activeStroke).
  const [dragPage, setDragPage] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [draftBox, setDraftBox] = useState(null);
  const [drawStrokes, setDrawStrokes] = useState([]);
  const [activeStroke, setActiveStroke] = useState(null);

  const [tool, setTool] = useState("box");
  const [color, setColor] = useState(COLORS[0]);

  const [newRegions, setNewRegions] = useState([]);
  const [pendingAnnotations, setPendingAnnotations] = useState([]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Integration flow: admin lands here via a launch URL and shouldn't see the
  // dashboard afterwards. On successful save we flip this and try to close the
  // tab; if the browser blocks the close, the screen below tells them to close it.
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [docRes, fileRes] = await Promise.all([
          api.get(`/documents/${id}`),
          api.get(`/documents/${id}/file`, { responseType: "blob" })
        ]);
        setDocument(docRes.data);
        setFileUrl(URL.createObjectURL(fileRes.data));

        let fetchedSigners = [];
        try {
          const mappedRes = await api.get(`/integration/documents/${id}/mapped-signers`);
          fetchedSigners = mappedRes.data;
        } catch {
          fetchedSigners = [];
        }
        // Fall back to all local signers when no SQL Server mapping is available
        // (locally-uploaded docs by admins who aren't in CpaDesk's LoginDetail).
        if (!fetchedSigners || fetchedSigners.length === 0) {
          const fallbackRes = await api.get("/users/signers");
          fetchedSigners = fallbackRes.data;
        }

        setSigners(fetchedSigners);
        setSelectedSigner(fetchedSigners.length === 1 ? fetchedSigners[0].id : "");
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load region setup"));
      }
    }
    load();
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [id]);

  const setViewportForPage = useCallback((n, vp) => {
    setPageViewports((prev) => {
      const existing = prev[n];
      if (existing && existing.width === vp.width && existing.height === vp.height) {
        return prev;
      }
      return { ...prev, [n]: vp };
    });
  }, []);

  // ── Pointer handlers (per page) ───────────────────────────────────────────
  const getPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  };

  const startDrag = (event, n) => {
    if (tool === "box" && !selectedSigner) return;
    const point = getPoint(event);
    if (tool === "draw") {
      // Starting a stroke on a different page resets the in-progress drawing —
      // a single annotation can't span pages because it's stored with one bbox.
      if (dragPage !== null && dragPage !== n) {
        setDrawStrokes([]);
        setActiveStroke(null);
      }
      setDragPage(n);
      setActiveStroke([[point.x, point.y]]);
      return;
    }
    setDragPage(n);
    setStartPoint(point);
    setDraftBox(null);
  };

  const moveDrag = (event, n) => {
    if (dragPage !== n) return; // ignore moves on pages other than the drag origin
    if (tool === "draw") {
      if (!activeStroke) return;
      const point = getPoint(event);
      setActiveStroke((prev) => (prev ? [...prev, [point.x, point.y]] : prev));
      return;
    }
    if (!startPoint) return;
    const current = getPoint(event);
    const x = Math.min(startPoint.x, current.x);
    const y = Math.min(startPoint.y, current.y);
    const width = Math.abs(startPoint.x - current.x);
    const height = Math.abs(startPoint.y - current.y);
    setDraftBox({ x, y, width, height });
  };

  const endDrag = (_event, n) => {
    if (dragPage !== n) return;
    if (tool === "draw") {
      if (activeStroke && activeStroke.length > 1) {
        setDrawStrokes((prev) => [...prev, activeStroke]);
      }
      setActiveStroke(null);
      return;
    }
    const vp = pageViewports[n];
    if (!draftBox || !vp || !vp.width || !vp.height) {
      setStartPoint(null);
      setDragPage(null);
      return;
    }
    if (draftBox.width < 10 || draftBox.height < 10) {
      setDraftBox(null);
      setStartPoint(null);
      setDragPage(null);
      return;
    }

    if (tool === "box") {
      if (!selectedSigner) {
        setDraftBox(null);
        setStartPoint(null);
        setDragPage(null);
        return;
      }
      const normalized = {
        id: crypto.randomUUID(),
        page_number: n,
        x: draftBox.x / vp.width,
        y: draftBox.y / vp.height,
        width: draftBox.width / vp.width,
        height: draftBox.height / vp.height,
        assigned_to: selectedSigner
      };
      setNewRegions((prev) => [...prev, normalized]);
    } else if (tool === "highlight") {
      const normalized = buildPendingAnnotation({
        kind: "highlight",
        color,
        pageNumber: n,
        boxPx: draftBox,
        viewport: vp,
        text: "",
        paths: ""
      });
      setPendingAnnotations((prev) => [...prev, normalized]);
    } else if (tool === "text") {
      const note = window.prompt("Comment for the signer (this will appear over the document):");
      if (note && note.trim()) {
        const normalized = buildPendingAnnotation({
          kind: "text",
          color,
          pageNumber: n,
          boxPx: draftBox,
          viewport: vp,
          text: note.trim(),
          paths: ""
        });
        setPendingAnnotations((prev) => [...prev, normalized]);
      }
    }

    setDraftBox(null);
    setStartPoint(null);
    setDragPage(null);
  };

  // ── Free-draw commit ──────────────────────────────────────────────────────
  const allDrawStrokes = activeStroke ? [...drawStrokes, activeStroke] : drawStrokes;

  const commitDrawing = () => {
    if (!drawStrokes.length || dragPage === null) {
      setError("Draw at least one stroke before committing.");
      return;
    }
    const vp = pageViewports[dragPage];
    if (!vp || !vp.width || !vp.height) {
      setError("Page not ready for drawing yet — try again in a moment.");
      return;
    }
    const bounds = strokeBounds(drawStrokes);
    if (!bounds) {
      setDrawStrokes([]);
      return;
    }
    const localPaths = drawStrokes.map((stroke) =>
      stroke.map(([px, py]) => [
        (px - bounds.x) / bounds.width,
        (py - bounds.y) / bounds.height
      ])
    );
    const normalized = buildPendingAnnotation({
      kind: "drawing",
      color,
      pageNumber: dragPage,
      boxPx: bounds,
      viewport: vp,
      text: "",
      paths: JSON.stringify(localPaths)
    });
    setPendingAnnotations((prev) => [...prev, normalized]);
    setDrawStrokes([]);
    setActiveStroke(null);
    setDragPage(null);
    setError("");
  };

  const clearDrawing = () => {
    setDrawStrokes([]);
    setActiveStroke(null);
  };

  const removePendingAnnotation = (annotationId) => {
    setPendingAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
  };

  const deleteSavedAnnotation = async (annotationId) => {
    if (!window.confirm("Delete this saved annotation?")) return;
    try {
      await api.delete(`/documents/${id}/annotations/${annotationId}`);
      setDocument((prev) =>
        prev
          ? { ...prev, annotations: (prev.annotations || []).filter((a) => a.id !== annotationId) }
          : prev
      );
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to delete annotation"));
    }
  };

  const submitAll = async () => {
    if (!newRegions.length && !pendingAnnotations.length && !drawStrokes.length) {
      setError("Add at least one signature box or annotation");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (newRegions.length) {
        await api.post(`/documents/${id}/regions`, {
          regions: newRegions.map(({ id: regionId, ...rest }) => rest)
        });
      }
      if (pendingAnnotations.length) {
        const payload = pendingAnnotations.map(({ id: tempId, ...rest }) => rest);
        await api.post(`/documents/${id}/annotations`, { annotations: payload });
      }
      if (newRegions.length) {
        try {
          await api.post(`/integration/documents/${id}/notify-prepared`);
        } catch {
          // not an ESign document or endpoint unavailable — continue normally
        }
      }
      setSaved(true);
      // Defer so React renders the completion screen before the browser
      // potentially closes the tab. window.close() is silently ignored if the
      // tab wasn't opened via window.open() — the screen below is the fallback.
      setTimeout(() => window.close(), 150);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  const activeToolHint = TOOLS.find((t) => t.value === tool)?.hint || "";

  // Map signer id → display name so each region box can show who it's assigned to.
  const signerNameById = useMemo(() => {
    const map = {};
    for (const s of signers) map[s.id] = s.name;
    return map;
  }, [signers]);
  const signerNameFor = (assignedTo) => signerNameById[assignedTo] || "Unknown signer";

  // ── Per-page derived values (called from renderPage) ──────────────────────
  const overlaysForPage = (n) => {
    const vp = pageViewports[n];
    if (!vp) return [];
    const existing = (document?.regions || [])
      .filter((region) => region.page_number === n)
      .map((region) => ({
        ...denormalize(region, vp),
        label: signerNameFor(region.assigned_to),
        className: "border-amber-500 bg-amber-500/20 pointer-events-none"
      }));
    const pending = newRegions
      .filter((region) => region.page_number === n)
      .map((region) => ({
        ...denormalize(region, vp),
        label: signerNameFor(region.assigned_to),
        className: "border-emerald-500 bg-emerald-500/20 pointer-events-none"
      }));
    const draft =
      dragPage === n && draftBox && tool === "box"
        ? [
            {
              id: "draft",
              x: draftBox.x,
              y: draftBox.y,
              width: draftBox.width,
              height: draftBox.height,
              className: "border-sky-500 bg-sky-500/20 pointer-events-none"
            }
          ]
        : [];
    return [...existing, ...pending, ...draft];
  };

  const annotationsForPage = (n) => {
    const serverAnnotations = (document?.annotations || []).filter((a) => a.page_number === n);
    const pendingForPage = pendingAnnotations.filter((a) => a.page_number === n);
    return [...serverAnnotations, ...pendingForPage];
  };

  const draftAnnotationForPage = (n) => {
    if (dragPage !== n || !draftBox) return null;
    if (tool === "highlight" || tool === "text") {
      return { kind: tool, color, ...draftBox };
    }
    return null;
  };

  const totalPages = document?.total_pages || 0;

  if (saved) {
    return (
      <AppShell title="Saved" hideHeader>
        <div className="mx-auto mt-24 max-w-md rounded-xl border border-emerald-700 bg-emerald-900/20 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-emerald-300">Saved</h2>
          <p className="text-sm text-slate-400">You may close this tab now.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Region Selection">
      {saving ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/80">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-500" />
          <p className="text-sm text-slate-300">Saving… please wait, this may take a few seconds.</p>
        </div>
      ) : null}
      {error ? <p className="mb-3 text-red-400">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {signers.length === 1 ? (
          <span className="text-sm text-slate-300">
            Signer: <strong className="text-white">{signers[0].name}</strong>
          </span>
        ) : (
          <label className="text-sm text-slate-300">
            Signer
            <select
              className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1"
              value={selectedSigner}
              onChange={(e) => setSelectedSigner(e.target.value)}
            >
              <option value="">— Select signer —</option>
              {signers.map((signer) => (
                <option key={signer.id} value={signer.id}>{signer.name}</option>
              ))}
            </select>
          </label>
        )}
        <button
          className="rounded bg-emerald-700 px-3 py-1 text-sm disabled:opacity-50"
          onClick={submitAll}
          disabled={saving}
          type="button"
        >
          {saving ? "Saving…" : "Save All"}
        </button>
      </div>

      {/* ── Tool palette ─────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Tool</span>
        {TOOLS.map((toolOpt) => (
          <button
            key={toolOpt.value}
            type="button"
            className={`rounded px-3 py-1 text-sm ${
              tool === toolOpt.value ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
            onClick={() => {
              setTool(toolOpt.value);
              setDraftBox(null);
              setStartPoint(null);
              setDragPage(null);
              if (toolOpt.value !== "draw") {
                setActiveStroke(null);
              }
            }}
          >
            {toolOpt.label}
          </button>
        ))}

        {tool !== "box" && (
          <>
            <span className="ml-3 text-xs uppercase tracking-wide text-slate-400">Color</span>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-white" : "border-slate-600"}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </>
        )}

        {tool === "draw" && (
          <>
            <button
              type="button"
              onClick={commitDrawing}
              className="ml-2 rounded bg-emerald-700 px-3 py-1 text-sm"
              disabled={!drawStrokes.length}
            >
              Finish Drawing
            </button>
            <button
              type="button"
              onClick={clearDrawing}
              className="rounded bg-slate-700 px-3 py-1 text-sm"
              disabled={!drawStrokes.length && !activeStroke}
            >
              Clear Strokes
            </button>
          </>
        )}
      </div>

      <p className="mb-2 text-xs text-slate-400">{activeToolHint}</p>

      {fileUrl && totalPages > 0 ? (
        <PdfDocumentScroller
          totalPages={totalPages}
          activePage={activePage}
          onActivePageChange={setActivePage}
          renderPage={(n) => (
            <PdfPageCanvas
              fileUrl={fileUrl}
              pageNumber={n}
              onPageViewport={(vp) => setViewportForPage(n, vp)}
              overlays={overlaysForPage(n)}
              annotations={annotationsForPage(n)}
              freeDrawPaths={tool === "draw" && dragPage === n ? allDrawStrokes : null}
              draftAnnotation={draftAnnotationForPage(n)}
              onCanvasPointerDown={(e) => startDrag(e, n)}
              onCanvasPointerMove={(e) => moveDrag(e, n)}
              onCanvasPointerUp={(e) => endDrag(e, n)}
            />
          )}
        />
      ) : null}

      {(pendingAnnotations.length || (document?.annotations || []).length) ? (
        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Annotations on this document</h3>
          <ul className="space-y-1 text-xs text-slate-300">
            {(document?.annotations || []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded bg-slate-800 px-2 py-1">
                <span>
                  <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ backgroundColor: a.color }} />
                  Page {a.page_number} • {a.kind}
                  {a.kind === "text" && a.text ? ` — "${a.text.slice(0, 60)}${a.text.length > 60 ? "…" : ""}"` : ""}
                </span>
                <button
                  type="button"
                  className="rounded bg-red-900/60 px-2 py-0.5 text-xs text-red-200 hover:bg-red-800"
                  onClick={() => deleteSavedAnnotation(a.id)}
                >
                  Delete
                </button>
              </li>
            ))}
            {pendingAnnotations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded bg-emerald-950/40 px-2 py-1">
                <span>
                  <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ backgroundColor: a.color }} />
                  Page {a.page_number} • {a.kind} (unsaved)
                  {a.kind === "text" && a.text ? ` — "${a.text.slice(0, 60)}${a.text.length > 60 ? "…" : ""}"` : ""}
                </span>
                <button
                  type="button"
                  className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-600"
                  onClick={() => removePendingAnnotation(a.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-sm text-slate-400">
        Scroll through the document or use the "Go to page" box above. Drag on a page to add a signature box
        (amber = existing, green = new). Use the tool palette to add highlights, free-draw, or comments —
        these are shown to the signer alongside the signature regions.
      </p>
    </AppShell>
  );
}

// Helper – builds the normalized payload an annotation requires from a pixel-space rectangle.
function buildPendingAnnotation({ kind, color, pageNumber, boxPx, viewport, text, paths }) {
  return {
    id: crypto.randomUUID(),
    page_number: pageNumber,
    kind,
    x: boxPx.x / viewport.width,
    y: boxPx.y / viewport.height,
    width: boxPx.width / viewport.width,
    height: boxPx.height / viewport.height,
    color,
    text,
    paths
  };
}
