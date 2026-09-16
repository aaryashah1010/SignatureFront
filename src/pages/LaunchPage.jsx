/**
 * LaunchPage – integration entry point.
 *
 * The external software redirects the user to:
 *   /lof?token=<HMAC-signed-JWT>
 *
 * This page:
 *  1. Reads the `token` query parameter.
 *  2. Sends it to GET /api/integration/launch.
 *  3. Stores the returned JWT + user in Zustand / localStorage.
 *  4. Navigates to the `next_route` the backend returns (role-specific deep link).
 *
 * No manual login is required in this flow.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { extractApiErrorMessage } from "../lib/errorMessage";
import { useAuthStore } from "../store/authStore";

export default function LaunchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const [error, setError] = useState("");
  const [status, setStatus] = useState("Validating launch token…");

  useEffect(() => {
    const token = searchParams.get("token");
    const role = searchParams.get("role") || "";
    // loginDetailId identifies WHICH signer is launching (3-tier flow). It must be
    // forwarded to the backend; without it the backend falls back to the parent
    // client id and the signer resolves to a user with no assigned regions (403).
    const loginDetailId = searchParams.get("loginDetailId");
    if (!token) {
      setError("No launch token provided. Please use the link supplied by your external software.");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    // CpaDesk's SQL Server is occasionally unreachable for a moment (network
    // blip, connection-pool exhaustion). The backend now reports that
    // specifically as 503 instead of a misleading "not found"/401, so retry
    // once automatically before ever bothering the user with an error — this is
    // the fix for the intermittent "session timeout" reports. Kept to a single
    // retry (not more): the backend already retries internally with its own
    // bounded timeout, so stacking more attempts here would only compound
    // worst-case wait time instead of helping.
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 1500;

    async function doLaunch(attempt = 1) {
      try {
        setStatus(
          attempt === 1
            ? "Authenticating with external software…"
            : `Reconnecting to external software… (attempt ${attempt}/${MAX_ATTEMPTS})`
        );
        const params = { token, role };
        if (loginDetailId) {
          params.loginDetailId = loginDetailId;
        }
        const { data } = await api.get("/integration/launch", {
          params,
          timeout: 45000,
          signal: controller.signal
        });

        if (cancelled) return;

        // Persist authentication state exactly as the normal login does.
        setAuth(data.access_token, data.user);

        setStatus(`Welcome, ${data.user.name}. Redirecting…`);

        // Brief pause so the user sees the welcome message.
        await new Promise((r) => setTimeout(r, 600));

        if (!cancelled) {
          navigate(data.next_route, { replace: true });
        }
      } catch (err) {
        if (cancelled) return;
        const isTemporary = err?.response?.status === 503;
        if (isTemporary && attempt < MAX_ATTEMPTS) {
          setStatus("Temporarily unable to reach external software, retrying…");
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          if (!cancelled) await doLaunch(attempt + 1);
          return;
        }
        setError(extractApiErrorMessage(err, "Launch failed. The link may have expired or already been used."));
      }
    }

    doLaunch();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-8 text-center shadow-xl">
        <h1 className="mb-6 text-xl font-semibold text-slate-100">
          Signature Platform
        </h1>

        {!error ? (
          <div className="space-y-4">
            {/* Spinner */}
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-500" />
            <p className="text-sm text-slate-400">{status}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-red-400">{error}</p>
            <a
              href="/login"
              className="inline-block rounded bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
            >
              Go to Login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
