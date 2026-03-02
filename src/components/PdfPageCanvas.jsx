import { useEffect, useRef } from "react";
import { loadPdfFromUrl } from "../lib/pdf";

export default function PdfPageCanvas({ fileUrl, pageNumber, onPageViewport, overlays, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!fileUrl || !canvasRef.current) return;
      const pdf = await loadPdfFromUrl(fileUrl);
      const page = await pdf.getPage(pageNumber);

      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;

      if (!cancelled) {
        onPageViewport?.({ width: viewport.width, height: viewport.height });
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [fileUrl, pageNumber, onPageViewport]);

  return (
    <div
      ref={containerRef}
      className="relative inline-block overflow-hidden rounded-xl border border-slate-700 bg-white"
      onMouseDown={onCanvasPointerDown}
      onMouseMove={onCanvasPointerMove}
      onMouseUp={onCanvasPointerUp}
    >
      <canvas ref={canvasRef} className="block max-w-full" />
      {overlays?.map((overlay) => (
        <div
          key={overlay.id}
          className={`absolute border-2 ${overlay.className || "border-emerald-500 bg-emerald-500/20"} cursor-pointer`}
          onClick={overlay.onClick}
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
