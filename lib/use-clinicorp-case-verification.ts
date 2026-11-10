import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type VerificationResult =
  | { state: "ready"; open_amount: number; due_date: string; valid_for_ms: number }
  | { state: "pending" | "missing_reference" | "closed" };

type Verification =
  | { state: "ready"; amount: number; dueDate: string; expiresAt: number }
  | { state: "checking" | "missing_reference" | "closed" | "slow" | "failed" };

const checking: Verification = { state: "checking" };
const pollIntervalMs = 2_000;
const slowPollIntervalMs = 5_000;
const slowAfterMs = 60_000;
const requestTimeoutMs = 10_000;

export function useClinicorpCaseVerification(caseId: number | null) {
  const [attempt, setAttempt] = useState(0);
  const selection = useMemo(() => ({ caseId, attempt }), [caseId, attempt]);
  const [result, setResult] = useState<{ selection: typeof selection; verification: Verification } | null>(null);

  useEffect(() => {
    if (selection.caseId === null) return;
    const id = selection.caseId;
    const supabase = getSupabaseBrowserClient();
    let controller: AbortController | undefined;
    let nextTimer: number;
    let slowTimer: number;
    let requestTimer: number;
    let active = true;
    let slow = false;

    const update = (verification: Verification) => setResult({ selection, verification });
    const finish = (verification: Verification) => {
      window.clearTimeout(slowTimer);
      update(verification);
    };
    const scheduleCheck = (request: boolean) => {
      nextTimer = window.setTimeout(() => void check(request), slow || document.hidden ? slowPollIntervalMs : pollIntervalMs);
    };

    async function check(request: boolean) {
      if (!active) return;
      if (document.hidden) {
        scheduleCheck(request);
        return;
      }
      const currentRequest = new AbortController();
      controller = currentRequest;
      const signal = currentRequest.signal;
      requestTimer = window.setTimeout(() => currentRequest.abort(), requestTimeoutMs);
      const startedAt = performance.now();
      try {
        const { data, error } = await supabase
          .rpc("get_clinicorp_case_verification", { p_case_id: id })
          .abortSignal(signal);
        if (!active) return;
        if (signal.aborted || error || !data) throw error ?? new Error("Conferência indisponível.");
        const status = data as VerificationResult;

        if (status.state === "ready") {
          // Use the server's remaining validity and account for the round trip.
          const expiresAt = startedAt + status.valid_for_ms;
          const remaining = expiresAt - performance.now();
          if (remaining > 0) {
            finish({ state: "ready", amount: status.open_amount, dueDate: status.due_date, expiresAt });
            nextTimer = window.setTimeout(() => {
              update(checking);
              start();
            }, remaining);
          } else {
            scheduleCheck(true);
          }
          return;
        }
        if (status.state !== "pending") {
          finish({ state: status.state });
          return;
        }
        if (request) {
          const { error: requestError } = await supabase
            .rpc("request_clinicorp_case_verification", { p_case_id: id })
            .abortSignal(signal);
          if (!active) return;
          if (signal.aborted || requestError) throw requestError ?? new Error("Conferência indisponível.");
        }
        scheduleCheck(false);
      } catch {
        if (active) finish({ state: "failed" });
      } finally {
        window.clearTimeout(requestTimer);
      }
    }

    function start() {
      slow = false;
      slowTimer = window.setTimeout(() => {
        slow = true;
        update({ state: "slow" });
      }, slowAfterMs);
      void check(true);
    }

    start();
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(nextTimer);
      window.clearTimeout(slowTimer);
      window.clearTimeout(requestTimer);
    };
  }, [selection]);

  const verification = result?.selection === selection ? result.verification : checking;
  return { verification, retry: () => setAttempt((current) => current + 1) };
}
