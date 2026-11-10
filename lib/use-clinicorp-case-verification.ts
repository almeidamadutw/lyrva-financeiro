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
const waitLimitMs = 60_000;

export function useClinicorpCaseVerification(caseId: number | null) {
  const [attempt, setAttempt] = useState(0);
  const selection = useMemo(() => ({ caseId, attempt }), [caseId, attempt]);
  const [result, setResult] = useState<{ selection: typeof selection; verification: Verification } | null>(null);

  useEffect(() => {
    if (selection.caseId === null) return;
    const id = selection.caseId;
    const supabase = getSupabaseBrowserClient();
    let controller: AbortController;
    let nextTimer: number;
    let waitTimer: number;

    const update = (verification: Verification) => setResult({ selection, verification });
    const finish = (verification: Verification) => {
      window.clearTimeout(waitTimer);
      update(verification);
    };

    async function check(request: boolean, signal: AbortSignal) {
      if (signal.aborted) return;
      const startedAt = performance.now();
      try {
        const { data, error } = await supabase
          .rpc("get_clinicorp_case_verification", { p_case_id: id })
          .abortSignal(signal);
        if (signal.aborted) return;
        if (error || !data) throw error ?? new Error("Conferência indisponível.");
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
            nextTimer = window.setTimeout(() => void check(true, signal), pollIntervalMs);
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
          if (signal.aborted) return;
          if (requestError) throw requestError;
        }
        nextTimer = window.setTimeout(() => void check(false, signal), pollIntervalMs);
      } catch {
        if (!signal.aborted) finish({ state: "failed" });
      }
    }

    function start() {
      controller = new AbortController();
      waitTimer = window.setTimeout(() => {
        controller.abort();
        window.clearTimeout(nextTimer);
        update({ state: "slow" });
      }, waitLimitMs);
      void check(true, controller.signal);
    }

    start();
    return () => {
      controller.abort();
      window.clearTimeout(nextTimer);
      window.clearTimeout(waitTimer);
    };
  }, [selection]);

  const verification = result?.selection === selection ? result.verification : checking;
  return { verification, retry: () => setAttempt((current) => current + 1) };
}
