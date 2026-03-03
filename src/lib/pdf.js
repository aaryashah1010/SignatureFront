import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

GlobalWorkerOptions.workerPort = new PdfJsWorker();

export async function loadPdfFromUrl(url) {
  const task = getDocument(url);
  return task.promise;
}
