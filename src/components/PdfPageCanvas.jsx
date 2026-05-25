import { useEffect, useRef, useState } from "react";
import { loadPdfFromUrl } from "../lib/pdf";

// PDF.js throws "Cannot use the same canvas during multiple render() operations"
// when a render task is still running and another one starts.  React StrictMode
// double-invocation, dep-array churn, and parent re-renders can all trigger this,
// so we keep track of the current task and cancel it before starting a new one.

// Render a single annotation overlay on top of the PDF page.
// `annotation` carries normalized [0..1] coords; the parent denormalizes via `viewport`.
function AnnotationOverlay({ annotation, viewport, readOnly, onClick }) {
  const left = annotation.x * viewport.width;
  const top = annotation.y * viewport.height;
  const width = annotation.width * viewport.width;
  const height = annotation.height * viewport.height;
  const baseStyle = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`
  };

  if (annotation.kind === "highlight") {
    return (
      <div
        className={`absolute rounded-sm ${readOnly ? "pointer-events-none" : "cursor-pointer"}`}
        style={{
          ...baseStyle,
          backgroundColor: annotation.color,
          opacity: 0.35,
          mixBlendMode: "multiply"
        }}
        onClick={onClick}
        title={annotation.text || "highlight"}
      />
    );
  }

  if (annotation.kind === "drawing") {
    let parsedPaths = [];
    try {
      parsedPaths = annotation.paths ? JSON.parse(annotation.paths) : [];
    } catch {
      parsedPaths = [];
    }
    return (
      <svg
        className={`absolute ${readOnly ? "pointer-events-none" : "cursor-pointer"}`}
        style={baseStyle}
        viewBox={`0 0 ${width} ${height}`}
        onClick={onClick}
      >
        {parsedPaths.map((path, idx) => {
          if (!Array.isArray(path) || path.length < 2) return null;
          const d = path
            .map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px * width} ${py * height}`)
            .join(" ");
          return (
            <path
              key={idx}
              d={d}
              fill="none"
              stroke={annotation.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    );
  }

  if (annotation.kind === "text") {
    return (
      <div
        className={`absolute rounded border bg-yellow-50 px-2 py-1 text-xs shadow-sm ${readOnly ? "pointer-events-none" : "cursor-pointer"}`}
        style={{
          ...baseStyle,
          borderColor: annotation.color,
          color: "#1f2937",
          overflow: "auto"
        }}
        onClick={onClick}
      >
        {annotation.text || "(empty comment)"}
      </div>
    );
  }

  return null;
}

export default function PdfPageCanvas({
  fileUrl,
  pageNumber,
  onPageViewport,
  overlays,
  annotations,
  freeDrawPaths,
  draftAnnotation,
  onAnnotationClick,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  readOnlyAnnotations
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // Stash the latest onPageViewport in a ref so its identity churn (callback
  // recreated on every parent render) does not retrigger the render effect.
  const onPageViewportRef = useRef(onPageViewport);
  useEffect(() => {
    onPageViewportRef.current = onPageViewport;
  }, [onPageViewport]);
  // Local state so annotation overlays re-render after the canvas is rasterized.
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;

    async function render() {
      if (!fileUrl || !canvasRef.current) return;
      try {
        const pdf = await loadPdfFromUrl(fileUrl);
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.3 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;

        if (!cancelled) {
          setRenderedSize({ width: viewport.width, height: viewport.height });
          onPageViewportRef.current?.({ width: viewport.width, height: viewport.height });
        }
      } catch (err) {
        // RenderingCancelledException is expected when we cancel in cleanup.
        if (err && err.name === "RenderingCancelledException") return;
        // Swallow other errors silently — the surrounding UI handles fallbacks.
      }
    }

    render();
    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore — render may already be complete
        }
      }
    };
  }, [fileUrl, pageNumber]);

  const containerWidth = renderedSize.width;
  const containerHeight = renderedSize.height;

  return (
    <div
      ref={containerRef}
      className="relative inline-block overflow-hidden rounded-xl border border-slate-700 bg-white"
      onMouseDown={onCanvasPointerDown}
      onMouseMove={onCanvasPointerMove}
      onMouseUp={onCanvasPointerUp}
      onMouseLeave={onCanvasPointerUp}
    >
      <canvas ref={canvasRef} className="block max-w-full" />

      {annotations?.map((annotation) => (
        <AnnotationOverlay
          key={annotation.id}
          annotation={annotation}
          viewport={{ width: containerWidth, height: containerHeight }}
          readOnly={readOnlyAnnotations}
          onClick={onAnnotationClick ? () => onAnnotationClick(annotation) : undefined}
        />
      ))}

      {/* Live free-draw preview – stroke captured while the admin is drawing. */}
      {freeDrawPaths && freeDrawPaths.length > 0 && containerWidth > 0 ? (
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={containerWidth}
          height={containerHeight}
        >
          {freeDrawPaths.map((path, idx) => {
            if (!Array.isArray(path) || path.length < 2) return null;
            const d = path
              .map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px} ${py}`)
              .join(" ");
            return (
              <path
                key={idx}
                d={d}
                fill="none"
                stroke={draftAnnotation?.color || "#ef4444"}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
      ) : null}

      {/* Draft text annotation rectangle (showing the bounds the admin is dragging). */}
      {draftAnnotation && draftAnnotation.kind === "text" ? (
        <div
          className="pointer-events-none absolute border-2 border-dashed"
          style={{
            left: `${draftAnnotation.x}px`,
            top: `${draftAnnotation.y}px`,
            width: `${draftAnnotation.width}px`,
            height: `${draftAnnotation.height}px`,
            borderColor: draftAnnotation.color
          }}
        />
      ) : null}

      {/* Draft highlight rectangle preview while dragging. */}
      {draftAnnotation && draftAnnotation.kind === "highlight" ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${draftAnnotation.x}px`,
            top: `${draftAnnotation.y}px`,
            width: `${draftAnnotation.width}px`,
            height: `${draftAnnotation.height}px`,
            backgroundColor: draftAnnotation.color,
            opacity: 0.35,
            mixBlendMode: "multiply"
          }}
        />
      ) : null}

      {overlays?.map((overlay) => (
        <div
          key={overlay.id}
          className={`absolute border-2 ${overlay.className || "border-emerald-500 bg-emerald-500/20"} cursor-pointer`}
          onClick={overlay.onClick}
          onDoubleClick={overlay.onDoubleClick}
          style={{
            left: `${overlay.x}px`,
            top: `${overlay.y}px`,
            width: `${overlay.width}px`,
            height: `${overlay.height}px`
          }}
        />
      ))}
    </div>
  );
}
