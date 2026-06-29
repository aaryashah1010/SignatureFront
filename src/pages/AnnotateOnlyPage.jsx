import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/client";
import AppShell from "../components/AppShell";
import PdfDocumentScroller from "../components/PdfDocumentScroller";
import PdfPageCanvas from "../components/PdfPageCanvas";
import { extractApiErrorMessage } from "../lib/errorMessage";

const TOOLS = [
  { value: "highlight", label: "Highlight", hint: "Drag to highlight an area." },
  { value: "draw", label: "Draw", hint: "Press and drag to draw freely. Release to start a new stroke." },
  { value: "text", label: "Comment", hint: "Drag to place a comment box, then type your note." }
];

const COLORS = ["#fde047", "#f87171", "#34d399", "#60a5fa", "#a78bfa", "#1f2937"];

function strokeBounds(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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

export default function AnnotateOnlyPage() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get("ref") || "";

  const [fileUrl, setFileUrl] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageViewports, setPageViewports] = useState({});

  const [dragPage, setDragPage] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [draftBox, setDraftBox] = useState(null);
  const [drawStrokes, setDrawStrokes] = useState([]);
  const [activeStroke, setActiveStroke] = useState(null);

  const [tool, setTool] = useState("highlight");
  const [color, setColor] = useState(COLORS[0]);
  const [pendingAnnotations, setPendingAnnotations] = useState([]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ref) {
      setError("No annotation reference provided in the link.");
      return;
    }
    let revoked = "";
    async function load() {
      try {
        const [metaRes, fileRes] = await Promise.all([
          api.get(`/annotate/${ref}/meta`),
          api.get(`/annotate/${ref}/file`, { responseType: "blob" })
        ]);
        setTotalPages(metaRes.data.total_pages || 0);
        const url = URL.createObjectURL(fileRes.data);
        revoked = url;
        setFileUrl(url);
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load document for annotation"));
      }
    }
    load();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [ref]);

  const setViewportForPage = useCallback((n, vp) => {
    setPageViewports((prev) => {
      const existing = prev[n];
      if (existing && existing.width === vp.width && existing.height === vp.height) return prev;
      return { ...prev, [n]: vp };
    });
  }, []);

  const getPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  };

  const startDrag = (event, n) => {
    const point = getPoint(event);
    if (tool === "draw") {
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
    if (dragPage !== n) return;
    if (tool === "draw") {
      if (!activeStroke) return;
      const point = getPoint(event);
      setActiveStroke((prev) => (prev ? [...prev, [point.x, point.y]] : prev));
      return;
    }
    if (!startPoint) return;
    const current = getPoint(event);
    setDraftBox({
      x: Math.min(startPoint.x, current.x),
      y: Math.min(startPoint.y, current.y),
      width: Math.abs(startPoint.x - current.x),
      height: Math.abs(startPoint.y - current.y)
    });
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
    if (!draftBox || !vp || !vp.width || !vp.height || draftBox.width < 10 || draftBox.height < 10) {
      setDraftBox(null);
      setStartPoint(null);
      setDragPage(null);
      return;
    }
    if (tool === "highlight") {
      setPendingAnnotations((prev) => [
        ...prev,
        buildPendingAnnotation({ kind: "highlight", color, pageNumber: n, boxPx: draftBox, viewport: vp, text: "", paths: "" })
      ]);
    } else if (tool === "text") {
      const note = window.prompt("Comment text:");
      if (note && note.trim()) {
        setPendingAnnotations((prev) => [
          ...prev,
          buildPendingAnnotation({ kind: "text", color, pageNumber: n, boxPx: draftBox, viewport: vp, text: note.trim(), paths: "" })
        ]);
      }
    }
    setDraftBox(null);
    setStartPoint(null);
    setDragPage(null);
  };

  const allDrawStrokes = activeStroke ? [...drawStrokes, activeStroke] : drawStrokes;

  const commitDrawing = () => {
    if (!drawStrokes.length || dragPage === null) {
      setError("Draw at least one stroke before committing.");
      return;
    }
    const vp = pageViewports[dragPage];
    if (!vp || !vp.width || !vp.height) {
      setError("Page not ready yet — try again in a moment.");
      return;
    }
    const bounds = strokeBounds(drawStrokes);
    if (!bounds) {
      setDrawStrokes([]);
      return;
    }
    const localPaths = drawStrokes.map((stroke) =>
      stroke.map(([px, py]) => [(px - bounds.x) / bounds.width, (py - bounds.y) / bounds.height])
    );
    setPendingAnnotations((prev) => [
      ...prev,
      buildPendingAnnotation({ kind: "drawing", color, pageNumber: dragPage, boxPx: bounds, viewport: vp, text: "", paths: JSON.stringify(localPaths) })
    ]);
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

  const save = async () => {
    if (!pendingAnnotations.length && !drawStrokes.length) {
      setError("Add at least one highlight, drawing or comment.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/annotate/save", {
        ref,
        annotations: pendingAnnotations.map(({ id: _id, ...rest }) => rest)
      });
      setSaved(true);
      setTimeout(() => window.close(), 200);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to save annotations"));
    } finally {
      setSaving(false);
    }
  };

  const annotationsForPage = (n) => pendingAnnotations.filter((a) => a.page_number === n);
  const draftAnnotationForPage = (n) => {
    if (dragPage !== n || !draftBox) return null;
    if (tool === "highlight" || tool === "text") return { kind: tool, color, ...draftBox };
    return null;
  };
  const activeToolHint = TOOLS.find((t) => t.value === tool)?.hint || "";

  if (saved) {
    return (
      <AppShell title="Saved" hideHeader>
        <div className="mx-auto mt-24 max-w-md rounded-xl border border-emerald-700 bg-emerald-900/20 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-emerald-300">Saved</h2>
          <p className="text-sm text-slate-400">Your annotations were sent back. You may close this tab now.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Annotate Document">
      {error ? <p className="mb-3 text-red-400">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-emerald-700 px-3 py-1 text-sm disabled:opacity-50"
          onClick={save}
          disabled={saving}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Tool</span>
        {TOOLS.map((toolOpt) => (
          <button
            key={toolOpt.value}
            type="button"
            className={`rounded px-3 py-1 text-sm ${tool === toolOpt.value ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            onClick={() => {
              setTool(toolOpt.value);
              setDraftBox(null);
              setStartPoint(null);
              setDragPage(null);
              if (toolOpt.value !== "draw") setActiveStroke(null);
            }}
          >
            {toolOpt.label}
          </button>
        ))}

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

        {tool === "draw" && (
          <>
            <button type="button" onClick={commitDrawing} className="ml-2 rounded bg-emerald-700 px-3 py-1 text-sm" disabled={!drawStrokes.length}>
              Finish Drawing
            </button>
            <button type="button" onClick={clearDrawing} className="rounded bg-slate-700 px-3 py-1 text-sm" disabled={!drawStrokes.length && !activeStroke}>
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

      {pendingAnnotations.length ? (
        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Annotations (unsaved)</h3>
          <ul className="space-y-1 text-xs text-slate-300">
            {pendingAnnotations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded bg-emerald-950/40 px-2 py-1">
                <span>
                  <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ backgroundColor: a.color }} />
                  Page {a.page_number} • {a.kind}
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
    </AppShell>
  );
}
