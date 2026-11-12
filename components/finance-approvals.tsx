"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { analyticsUnitCode } from "@/lib/collection-analytics";
import { formatPayAmount, serviceLabels } from "@/lib/professional-pay";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PendingProfessionalPayApproval } from "@/lib/supabase/database.types";

const pageSize = 30;
const formatWorkDate = (date: string) => date.split("-").reverse().join("/");

export function FinanceApprovalsView({ unit }: { unit: string }) {
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: PendingProfessionalPayApproval[]; failed: boolean }>();
  const [selected, setSelected] = useState<PendingProfessionalPayApproval>();
  const unitCode = analyticsUnitCode(unit);
  const key = `${unitCode ?? "todas"}:${page}:${refresh}`;
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void getSupabaseBrowserClient().rpc("get_pending_professional_pay_approvals", {
      p_unit_code: unitCode ?? undefined,
      p_offset: page * pageSize,
    }).abortSignal(controller.signal).then(({ data, error }) => {
      if (!controller.signal.aborted) setResult({ key, rows: data ?? [], failed: Boolean(error) });
    });
    return () => controller.abort();
  }, [key, page, unitCode]);

  function reload() {
    setSelected(undefined);
    setPage(0);
    setRefresh((value) => value + 1);
  }

  return (
    <section aria-labelledby="professional-pay-approval-heading" className="surface-card overflow-hidden rounded-[24px]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div>
          <h2 id="professional-pay-approval-heading" className="font-display text-xl font-semibold">Diárias aguardando aprovação</h2>
          <p className="mt-1 text-sm text-muted-foreground">Confira o lançamento e libere para pagamento ou devolva ao financeiro.</p>
        </div>
        <Button variant="outline" size="sm" disabled={!current} onClick={reload}>Atualizar fila</Button>
      </div>
      {!current ? (
        <p role="status" className="flex items-center gap-2 p-5 text-sm"><LoaderCircle className="size-4 animate-spin" /> Carregando aprovações…</p>
      ) : current.failed ? (
        <p role="alert" className="p-5 text-sm text-destructive">Não foi possível carregar as aprovações. Atualize a fila para tentar novamente.</p>
      ) : current.rows.length > 0 ? (
        <Table aria-label="Diárias aguardando aprovação" className="min-w-[620px]">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="pl-5">Profissional</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="pr-5 text-right"><span className="sr-only">Ação</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.rows.slice(0, pageSize).map((row) => <TableRow key={row.id}>
              <TableCell className="pl-5 font-medium">{row.professional_name}</TableCell>
              <TableCell>{row.unit_name}</TableCell>
              <TableCell>{formatWorkDate(row.work_date)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPayAmount(row.amount_cents)}</TableCell>
              <TableCell className="pr-5 text-right">
                <Button variant="outline" size="sm" onClick={() => setSelected(row)}
                  aria-label={`Revisar diária de ${row.professional_name} em ${formatWorkDate(row.work_date)}`}>Revisar</Button>
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">{page ? "Nenhuma diária nesta página." : "Nenhuma diária aguardando aprovação nesta seleção."}</p>
      )}
      {current && !current.failed && (page > 0 || current.rows.length > pageSize) && (
        <nav aria-label="Páginas de aprovações" className="flex items-center justify-end gap-3 border-t p-4">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span className="text-sm tabular-nums">Página {page + 1}</span>
          <Button size="sm" variant="outline" disabled={current.rows.length <= pageSize} onClick={() => setPage(page + 1)}>Próxima</Button>
        </nav>
      )}
      {selected && <ApprovalDialog row={selected} onClose={() => setSelected(undefined)} onRefresh={reload} />}
    </section>
  );
}

function ApprovalDialog({ row, onClose, onRefresh }: {
  row: PendingProfessionalPayApproval; onClose: () => void; onRefresh: () => void;
}) {
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(reason?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: requestError } = reason
        ? await supabase.rpc("save_professional_attendance", {
          p_unit_id: row.unit_id, p_action: "reopen",
          p_input: { professional_id: row.professional_id, work_date: row.work_date, revision: row.revision, reason },
        })
        : await supabase.rpc("approve_professional_attendance", {
          p_unit_id: row.unit_id, p_attendance_id: row.id, p_revision: row.revision,
        });
      if (requestError) {
        setError(requestError.message);
        return;
      }
      toast.success(reason ? "Diária devolvida para correção" : "Diária aprovada para pagamento");
      onRefresh();
    } catch {
      setError("Não foi possível concluir a decisão. Atualize a fila antes de tentar novamente.");
    } finally {
      setBusy(false);
    }
  }

  function returnForCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason) void decide(reason);
    else setError("Informe o motivo da devolução.");
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{row.professional_name}</DialogTitle>
        <DialogDescription>{formatWorkDate(row.work_date)} · {row.unit_name}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
        <span>{serviceLabels[row.service_kind]}</span>
        <strong className="tabular-nums">{formatPayAmount(row.amount_cents)}</strong>
      </div>
      {row.notes && <p className="whitespace-pre-wrap text-sm">{row.notes}</p>}
      {row.priced_items.length > 0 && <ul className="space-y-1 text-sm text-muted-foreground">
        {row.priced_items.map((item) => <li key={item.name}>
          {row.service_kind === "fixed_day" ? item.name : `${item.quantity} × ${item.name} · ${formatPayAmount(item.unit_cents)} cada`}
        </li>)}
      </ul>}
      {returning ? (
        <form onSubmit={returnForCorrection} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="approval-return-reason">Motivo da devolução</Label>
            <Textarea id="approval-return-reason" name="reason" required maxLength={600} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setReturning(false); setError(""); }}>Voltar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Confirmar devolução"}</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setReturning(true); setError(""); }}>Devolver para correção</Button>
          <Button type="button" disabled={busy} onClick={() => void decide()}>{busy ? "Salvando…" : "Aprovar diária"}</Button>
        </div>
      )}
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
        <span>{error}</span><Button variant="outline" size="sm" onClick={onRefresh}>Atualizar fila</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
