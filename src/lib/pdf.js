import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

export async function loadPdfFromUrl(url) {
  const task = getDocument(url);
  return task.promise;
}
