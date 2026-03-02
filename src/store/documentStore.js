import { create } from "zustand";

export const useDocumentStore = create((set) => ({
  selectedDocument: null,
  setSelectedDocument: (doc) => set({ selectedDocument: doc })
}));
