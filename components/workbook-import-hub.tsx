"use client";

import { useState } from "react";
import { FileSpreadsheet, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CollectionsWorkbookImportView } from "@/components/collections-workbook-import";
import { NfWorkbookImportView } from "@/components/nf-workbook-import";

export function WorkbookImportHub({ onImported }: { onImported: () => Promise<void> }) {
  const [mode, setMode] = useState<"nf" | "collections">("nf");
  return <div className="space-y-5">
    <section className="surface-card rounded-[24px] p-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setMode("nf")} variant={mode === "nf" ? "default" : "outline"} className="rounded-xl"><FileSpreadsheet /> Pacientes e NF</Button>
        <Button type="button" onClick={() => setMode("collections")} variant={mode === "collections" ? "default" : "outline"} className="rounded-xl"><WalletCards /> Régua de cobrança</Button>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#718078]">Importe primeiro a planilha atualizada de pacientes/NF. Depois, use a planilha da régua para trazer o histórico da Dai sem criar pacientes novos.</p>
    </section>
    {mode === "nf" ? <NfWorkbookImportView onImported={onImported} /> : <CollectionsWorkbookImportView onImported={onImported} />}
  </div>;
}
