import { create } from "zustand";

const STORAGE_KEY = "signature_auth";

function loadPersisted() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { token: null, user: null };
  try {
    return JSON.parse(raw);
  } catch {
    return { token: null, user: null };
  }
}

export const useAuthStore = create((set) => ({
  ...loadPersisted(),
  setAuth: (token, user) =>
    set(() => {
      const state = { token, user };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    }),
  clearAuth: () =>
    set(() => {
      localStorage.removeItem(STORAGE_KEY);
      return { token: null, user: null };
    })
}));
