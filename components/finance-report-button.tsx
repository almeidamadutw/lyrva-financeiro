"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FinanceReport } from "@/lib/finance-report-pdf";

export function FinanceReportButton({ report, disabled }: { report: () => FinanceReport; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const snapshot = report();
      const { downloadFinanceReport } = await import("@/lib/finance-report-pdf");
      await downloadFinanceReport(snapshot);
    } catch {
      toast.error("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return <Button type="button" variant="outline" className="rounded-xl" disabled={disabled || busy} onClick={download}>
    {busy ? <LoaderCircle className="animate-spin" /> : <Download />} {busy ? "Gerando PDF…" : "Baixar PDF"}
  </Button>;
}
