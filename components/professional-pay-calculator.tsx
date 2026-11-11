"use client";

import { useEffect, useState } from "react";
import { Calculator, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPayAmount, MAX_PAY_CENTS, payCents, pricedAttendanceTotal } from "@/lib/professional-pay";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProfessionalAttendancePriceItem, ProfessionalPayPriceItem } from "@/lib/supabase/database.types";

type PriceDraft = { id: number; name: string; amount: string };

const selectClass = "h-9 w-full rounded-md border border-input bg-white px-3 text-sm";
const amountText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
export const normalizePayItemName = (name: string) => name.trim().replace(/\s+/g, " ");

export function DeliveryPriceFields({ items }: { items: ProfessionalPayPriceItem[] }) {
  const [drafts, setDrafts] = useState<PriceDraft[]>(() => items.map((item, id) => ({
    id, name: item.name, amount: amountText(item.unit_cents),
  })));
  const [nextId, setNextId] = useState(items.length);

  return <fieldset className="space-y-3 rounded-xl border p-3">
    <legend className="px-1 text-sm font-medium">Valores por entrega</legend>
    {drafts.map((item, index) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <Label htmlFor={`delivery-name-${item.id}`}>Entrega {index + 1}</Label>
        <Input id={`delivery-name-${item.id}`} name="delivery-name" value={item.name} minLength={2} maxLength={120} required
          onChange={(event) => setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, name: event.target.value } : draft))} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`delivery-price-${item.id}`}>Valor (R$)</Label>
        <Input id={`delivery-price-${item.id}`} name="delivery-price" inputMode="decimal" placeholder="0,00" value={item.amount} maxLength={14} required
          onChange={(event) => setDrafts((current) => current.map((draft) => draft.id === item.id ? { ...draft, amount: event.target.value } : draft))} />
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label={`Remover entrega ${index + 1}`}
        onClick={() => setDrafts((current) => current.filter((draft) => draft.id !== item.id))}><Trash2 /></Button>
    </div>)}
    <Button type="button" variant="outline" size="sm" onClick={() => {
      setDrafts((current) => [...current, { id: nextId, name: "", amount: "" }]);
      setNextId((current) => current + 1);
    }}><Plus /> Incluir valor padrão</Button>
  </fieldset>;
}

export function AttendancePriceCalculator({ mode, unitId, professionalId, catalog, appliedItems, disabled, onApply }: {
  mode: "delivery" | "procedure";
  unitId: number;
  professionalId: number;
  catalog: ProfessionalPayPriceItem[];
  appliedItems: ProfessionalAttendancePriceItem[];
  disabled: boolean;
  onApply: (items: ProfessionalAttendancePriceItem[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ProfessionalAttendancePriceItem[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [history, setHistory] = useState<ProfessionalPayPriceItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const isDelivery = mode === "delivery";

  useEffect(() => {
    if (!open || isDelivery) return;
    let active = true;
    void getSupabaseBrowserClient().rpc("get_professional_procedure_prices", { p_unit_id: unitId, p_professional_id: professionalId })
      .then(({ data, error }) => {
        if (!active) return;
        setHistory(data ?? []);
        setHistoryError(Boolean(error));
        setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [open, isDelivery, unitId, professionalId]);

  function changeOpen(next: boolean) {
    if (next) {
      setItems(appliedItems);
      setName("");
      setAmount("");
      setQuantity("1");
      setHistoryError(false);
      setHistoryLoading(!isDelivery);
    }
    setOpen(next);
  }

  function changeName(next: string) {
    setName(next);
    const match = history.find((item) => item.name.toLowerCase() === normalizePayItemName(next).toLowerCase());
    setAmount(match ? amountText(match.unit_cents) : "");
  }

  const normalizedName = normalizePayItemName(name);
  const fixedItem = isDelivery ? catalog.find((item) => item.name === name) : undefined;
  const unitCents = isDelivery ? fixedItem?.unit_cents : payCents(amount);
  const count = /^[1-9]\d{0,9}$/.test(quantity) ? Number(quantity) : 0;
  const total = pricedAttendanceTotal(items);
  const alreadyAdded = items.some((item) => item.name.toLowerCase() === normalizedName.toLowerCase());
  const canAdd = normalizedName.length >= 2 && normalizedName.length <= 120 && Boolean(unitCents && count && !alreadyAdded
    && total + unitCents * count <= MAX_PAY_CENTS);

  function addItem() {
    if (!canAdd || !unitCents) return;
    setItems((current) => [...current, { name: fixedItem?.name ?? normalizedName, unit_cents: unitCents, quantity: count }]);
    setName("");
    setAmount("");
    setQuantity("1");
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <Button type="button" variant="ghost" size="sm" disabled={disabled}
        className="-ml-2 gap-1.5 px-2 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
        <Calculator aria-hidden="true" className="size-4" /> Calcular valores
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Calcular valores</DialogTitle>
        <DialogDescription>{isDelivery ? "Inclua as entregas conferidas." : "Inclua os procedimentos conferidos. O valor sugerido vem do último lançamento validado."}</DialogDescription>
      </DialogHeader>
      {isDelivery && !catalog.length ? <p className="text-sm">Cadastre os valores em <strong>Regra de remuneração</strong> para usar a calculadora.</p> : <>
        <div className="space-y-2">
          <Label htmlFor="pay-calculator-item">{isDelivery ? "Entrega" : "Procedimento"}</Label>
          {isDelivery ? <select id="pay-calculator-item" className={selectClass} value={name} onChange={(event) => setName(event.target.value)}>
            <option value="">Selecione uma entrega</option>
            {catalog.map((item) => <option key={item.name} value={item.name}>{item.name} · {formatPayAmount(item.unit_cents)}</option>)}
          </select> : <>
            <Input id="pay-calculator-item" list="pay-calculator-history" value={name} maxLength={120} autoComplete="off" disabled={historyLoading}
              placeholder="Selecione ou digite um procedimento" onChange={(event) => changeName(event.target.value)} />
            <datalist id="pay-calculator-history">
              {history.map((item) => <option key={item.name} value={item.name}>{formatPayAmount(item.unit_cents)}</option>)}
            </datalist>
            {historyLoading && <p role="status" className="text-xs text-muted-foreground">Carregando valores anteriores…</p>}
            {historyError && <p role="alert" className="text-xs text-destructive">Não foi possível carregar o histórico de valores. Confira antes de informar um valor.</p>}
          </>}
        </div>
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
          <div className="space-y-1">
            <Label htmlFor="pay-calculator-amount">Valor unitário (R$)</Label>
            <Input id="pay-calculator-amount" inputMode="decimal" placeholder="0,00" maxLength={14} readOnly={isDelivery}
              value={isDelivery ? (fixedItem ? amountText(fixedItem.unit_cents) : "") : amount}
              onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-calculator-quantity">Quantidade</Label>
            <Input id="pay-calculator-quantity" inputMode="numeric" value={quantity} maxLength={10}
              onChange={(event) => setQuantity(event.target.value)} />
          </div>
          <Button type="button" variant="outline" className="col-span-2 justify-self-end sm:col-span-1"
            disabled={!canAdd} onClick={addItem}><Plus /> Incluir</Button>
        </div>
        {alreadyAdded && <p className="text-xs text-muted-foreground">Este item já está na lista. Remova-o para incluir com outra quantidade ou valor.</p>}
        {Boolean(unitCents && count && total + unitCents * count > MAX_PAY_CENTS) && <p role="alert" className="text-xs text-destructive">O total ultrapassa o valor permitido para um lançamento.</p>}
        {items.length > 0 && <ul className="divide-y rounded-xl border px-3">
          {items.map((item) => <li key={item.name} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0"><p className="break-words font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">{item.quantity} × {formatPayAmount(item.unit_cents)}</p></div>
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap tabular-nums">{formatPayAmount(item.unit_cents * item.quantity)}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover ${item.name}`}
                onClick={() => setItems((current) => current.filter((entry) => entry.name !== item.name))}><Trash2 /></Button>
            </div>
          </li>)}
        </ul>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-sm">Total <strong aria-live="polite" className="tabular-nums">{formatPayAmount(total)}</strong></p>
          <Button type="button" disabled={!items.length} onClick={() => { onApply(items); setOpen(false); }}>Adicionar à diária</Button>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
