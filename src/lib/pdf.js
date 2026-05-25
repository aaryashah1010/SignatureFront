import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

GlobalWorkerOptions.workerPort = new PdfJsWorker();

// Cache loaded PDFs per URL so a multi-page scroller doesn't re-fetch and
// re-parse the file once for each rendered page.
const cache = new Map();

export async function loadPdfFromUrl(url) {
  if (cache.has(url)) return cache.get(url);
  const promise = getDocument(url).promise.catch((err) => {
    cache.delete(url);
    throw err;
  });
  cache.set(url, promise);
  return promise;
}
