import { useState } from "react";

export default function AppShell({ title, children, hideHeader = false }) {
  const [closedHint, setClosedHint] = useState(false);

  const handleCancel = () => {
    // These screens are opened via the CPA launch (window.open), so closing the
    // tab is the right exit. window.close() is silently ignored if the tab wasn't
    // opened programmatically — the hint below tells the user to close it manually.
    window.close();
    setClosedHint(true);
  };

  if (closedHint) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="mx-auto max-w-md rounded-xl border border-slate-700 bg-slate-900 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-slate-100">Closed</h2>
          <p className="text-sm text-slate-400">You may close this tab now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-10">
      <div className="mx-auto max-w-7xl">
        {!hideHeader && (
          <header className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-glow">
            <h1 className="title-font text-2xl text-sky-200">{title}</h1>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-lg text-slate-300 hover:border-red-500 hover:text-red-400"
              onClick={handleCancel}
              type="button"
              title="Cancel and close"
              aria-label="Cancel and close"
            >
              ✕
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
