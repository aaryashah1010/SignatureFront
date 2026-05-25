import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * Stacks every page of a PDF in a scrollable container with a jump-to-page input.
 *
 * Props:
 *   totalPages          - total pages in the PDF
 *   renderPage(n)       - parent renders the <PdfPageCanvas> (or any node) for page n
 *   activePage          - currently-active page (controlled)
 *   onActivePageChange  - fires when scroll lands on a new page, or jump-to-page is used
 *   maxHeightClass      - tailwind class for the scroll container height (default 80vh)
 *
 * Ref:
 *   scrollToPage(n)     - imperatively scroll to page n
 */
const PdfDocumentScroller = forwardRef(function PdfDocumentScroller(
  {
    totalPages,
    renderPage,
    activePage,
    onActivePageChange,
    maxHeightClass = "max-h-[80vh]"
  },
  ref
) {
  const containerRef = useRef(null);
  const pageRefs = useRef({});
  const [jumpValue, setJumpValue] = useState(String(activePage || 1));

  // Update active page based on which page is most visible in the scroll viewport.
  useEffect(() => {
    if (!containerRef.current || !totalPages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the most visible intersecting entry.
        let best = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
          }
        }
        if (!best) return;
        const page = Number(best.target.getAttribute("data-page"));
        if (page && page !== activePage) onActivePageChange?.(page);
      },
      { root: containerRef.current, threshold: [0.25, 0.5, 0.75] }
    );
    for (const el of Object.values(pageRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [totalPages, activePage, onActivePageChange]);

  // Keep the input in sync with external scroll-driven activePage changes.
  useEffect(() => {
    setJumpValue(String(activePage || 1));
  }, [activePage]);

  // Scroll so that page `n` is visible. If `centerOnPagePx` is given,
  // it is a Y coordinate (in pixels) within the page element to center
  // in the viewport — useful for landing on a specific region inside the page.
  const scrollToPage = (n, centerOnPagePx = null) => {
    const el = pageRefs.current[n];
    if (!el || !containerRef.current) return;
    const container = containerRef.current;
    let top = el.offsetTop - container.offsetTop;
    if (centerOnPagePx != null) {
      const viewportH = container.clientHeight;
      top = top + centerOnPagePx - viewportH / 2;
    }
    // Clamp to scrollable range so we don't request impossible positions.
    const maxTop = container.scrollHeight - container.clientHeight;
    top = Math.max(0, Math.min(maxTop, top));
    container.scrollTo({ top, behavior: "smooth" });
  };

  useImperativeHandle(ref, () => ({ scrollToPage }), []);

  const handleJump = (event) => {
    event.preventDefault();
    const n = Math.max(1, Math.min(totalPages, Number(jumpValue) || 1));
    setJumpValue(String(n));
    onActivePageChange?.(n);
    scrollToPage(n);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
        <form onSubmit={handleJump} className="flex items-center gap-2">
          <label htmlFor="pdf-jump-input">Go to page</label>
          <input
            id="pdf-jump-input"
            type="number"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1"
          />
          <button
            type="submit"
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Go
          </button>
        </form>
        <span className="text-slate-400">
          Page <strong className="text-white">{activePage || 1}</strong> of {totalPages}
        </span>
      </div>

      <div
        ref={containerRef}
        className={`relative overflow-auto rounded-xl border border-slate-700 bg-slate-900 ${maxHeightClass}`}
      >
        <div className="flex flex-col items-center gap-6 p-4">
          {Array.from({ length: totalPages }).map((_, idx) => {
            const n = idx + 1;
            return (
              <div
                key={n}
                data-page={n}
                ref={(el) => {
                  pageRefs.current[n] = el;
                }}
                className="flex flex-col items-center"
              >
                <div className="mb-1 text-xs text-slate-400">Page {n}</div>
                {renderPage(n)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default PdfDocumentScroller;
