"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowDownToLine, CalendarDays, Handshake, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  analyticsDateRange, analyticsMonthLabel, analyticsUnitCode, collectionAnalyticsSchema,
} from "@/lib/collection-analytics";
import type { AnalyticsMonths, CollectionAnalytics } from "@/lib/collection-analytics";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const compactCurrency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const tooltipStyle = { borderRadius: 14, border: "1px solid #dfe5df", fontSize: 12 };
const colors = { pending: "#c58d30", renegotiated: "#168a5c", received: "#527bc0" };

function saoPauloMonth() {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/Sao_Paulo" })
    .format(new Date());
}

export function CollectionAnalyticsView({ unit }: { unit: string }) {
  const [endMonth, setEndMonth] = useState(saoPauloMonth);
  const [months, setMonths] = useState<AnalyticsMonths>(6);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data: CollectionAnalytics } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const range = analyticsDateRange(endMonth, months);
  const unitCode = analyticsUnitCode(unit);
  const key = `${unitCode ?? "todas"}|${range.from}|${range.to}|${refresh}`;
  const data = result?.key === key ? result.data : null;
  const error = failure?.key === key ? failure.message : null;
  const loading = !data && !error;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const { data: response, error: requestError } = await getSupabaseBrowserClient()
          .rpc("get_collection_analytics", {
            p_unit_code: unitCode ?? undefined,
            p_date_from: range.from,
            p_date_to: range.to,
          }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (requestError) throw new Error(requestError.message);
        const parsed = collectionAnalyticsSchema.safeParse(response);
        if (!parsed.success) throw new Error("O resumo retornado não pôde ser validado. Atualize para tentar novamente.");
        setResult({ key, data: parsed.data });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFailure({ key, message: cause instanceof Error ? cause.message : "Não foi possível consultar os gráficos." });
      }
    };
    void load();
    return () => controller.abort();
  }, [key, unitCode, range.from, range.to]);

  return <div className="space-y-5">
    <section className="surface-card flex flex-col gap-5 rounded-[24px] p-5 lg:flex-row lg:items-end lg:justify-between md:p-6">
      <div className="max-w-lg">
        <p className="eyebrow">EVOLUÇÃO DA COBRANÇA</p>
        <h2 className="font-display mt-2 text-2xl font-semibold text-[#192820]">Cada avanço fica visível.</h2>
        <p className="mt-2 text-sm leading-6 text-[#718078]">Acompanhe a carteira em aberto, as dívidas renegociadas e os pagamentos confirmados.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="analytics-month" className="text-xs text-[#65736b]">Até o mês</Label>
          <Input id="analytics-month" type="month" value={endMonth} min="2016-01" max={saoPauloMonth()}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2016-01" && value <= saoPauloMonth()) setEndMonth(value);
            }} className="h-10 w-44 rounded-xl bg-white" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="analytics-window" className="text-xs text-[#65736b]">Período</Label>
          <Select value={String(months)} onValueChange={(value) => setMonths(Number(value) as AnalyticsMonths)}>
            <SelectTrigger id="analytics-window" className="h-10 w-36 rounded-xl bg-white"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="1">1 mês</SelectItem><SelectItem value="3">3 meses</SelectItem><SelectItem value="6">6 meses</SelectItem><SelectItem value="12">12 meses</SelectItem></SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="h-10 rounded-xl" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Atualizar
        </Button>
      </div>
    </section>

    {loading ? <div role="status" className="surface-card grid min-h-72 place-content-center justify-items-center gap-3 rounded-[24px] p-6 text-sm text-[#718078]">
      <LoaderCircle className="size-6 animate-spin text-[#168a5c]" />Carregando os gráficos desta unidade…
    </div> : error ? <div role="alert" className="surface-card space-y-3 rounded-[24px] p-6">
      <div className="flex items-center gap-2 font-semibold text-[#934e3f]"><AlertCircle className="size-5" />Os gráficos não foram carregados.</div>
      <p className="text-sm text-[#718078]">{error}</p>
      <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Tentar novamente</Button>
    </div> : data ? <CollectionAnalyticsDashboard data={data} /> : null}
  </div>;
}

export function CollectionAnalyticsDashboard({ data }: { data: CollectionAnalytics }) {
  const chartGrid = data.monthly.length > 6
    ? "grid min-w-0 gap-5"
    : "grid min-w-0 gap-5 2xl:grid-cols-2";
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#718078]">
      <p className="flex flex-wrap items-center gap-2"><CalendarDays className="size-4" />{dateLabel(data.period.from)} a {dateLabel(data.period.to)}{data.period.to.slice(0, 7) === saoPauloMonth() ? <span className="rounded-full bg-[#edf2e8] px-2 py-1 text-[10px] text-[#65795a]">Mês atual em andamento</span> : null}</p>
      <div className="space-y-1 text-left sm:text-right"><p>Consultado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(data.generatedAt))}</p>
        {data.pending.oldestVerifiedAt ? <p>Conferência mais antiga da carteira: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(data.pending.oldestVerifiedAt))}</p> : null}</div>
    </div>

    {data.pending.unverifiedCount > 0 ? <div role="status" className="flex items-start gap-3 rounded-2xl border border-[#efd8ab] bg-[#fff9ec] px-4 py-3 text-sm leading-6 text-[#856427]">
      <AlertCircle className="mt-1 size-4 shrink-0" /><p><strong>Carteira parcialmente conferida.</strong> {data.pending.unverifiedCount} título(s) aguardam conferência com o Clinicorp e ficam fora dos valores para renegociar.</p>
    </div> : null}

    {data.received.unverifiedCount > 0 ? <div role="status" className="flex items-start gap-3 rounded-2xl border border-[#efd8ab] bg-[#fff9ec] px-4 py-3 text-sm leading-6 text-[#856427]">
      <AlertCircle className="mt-1 size-4 shrink-0" /><p><strong>Quitações parcialmente conferidas.</strong> {data.received.unverifiedCount} título(s) aguardam conferência da baixa e ficam fora dos valores quitados.</p>
    </div> : null}

    <section className="grid gap-4 md:grid-cols-3" aria-label="Resumo da cobrança">
      <AnalyticsMetric label="Valor para renegociar" amount={data.pending.amount} count={`${data.pending.count} título(s) conferido(s)`}
        detail="Saldo atual dos títulos da régua com vencimento no período." icon={WalletCards} tone="bg-[#fff1d8] text-[#946614]" />
      <AnalyticsMetric label="Dívida renegociada" amount={data.renegotiated.amount} count={`${data.renegotiated.count} título(s) renegociado(s)`}
        detail="Dívidas com renegociação concluída no período; consulte a base do valor abaixo." icon={Handshake} tone="bg-[#e4f8ee] text-[#00884a]" />
      <AnalyticsMetric label="Boletos quitados em atraso" amount={data.received.amount} count={`${data.received.count} título(s) com baixa confirmada`}
        detail="Boletos pagos no período, a partir de D+3 dias úteis de atraso, com baixa confirmada no Clinicorp." icon={ArrowDownToLine} tone="bg-[#e9f0fc] text-[#527bc0]" />
    </section>

    <section className={chartGrid}>
      <MonthlyChart title="O que falta renegociar" description="Saldo que continua aberto hoje, separado pelo mês de vencimento."
        data={data.monthly} dataKey="pending" label="Em aberto" color={colors.pending} />
      <MonthlyChart title="Quanto foi renegociado" description="Dívidas dos títulos renegociados, pelo mês de conclusão do acordo."
        data={data.monthly} dataKey="renegotiated" label="Dívida renegociada" color={colors.renegotiated} />
    </section>

    <section className={chartGrid}>
      <MonthlyChart title="Quanto foi quitado" description="Valor de boletos quitados em atraso, pelo mês do pagamento. Promessas ficam de fora."
        data={data.monthly} dataKey="received" label="Quitado" color={colors.received} line />
      <article className="surface-card min-w-0 rounded-[24px] p-5 md:p-6">
        <h3 className="font-display text-lg font-semibold text-[#192820]">Há quanto tempo está em aberto?</h3>
        <p className="mt-1 text-sm leading-6 text-[#718078]">Idade atual dos títulos conferidos com vencimento no período.</p>
        <div className="mt-6 space-y-5">
          {data.aging.map((item) => <div key={item.label}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-[#65736b]">{item.label} <span className="text-xs text-[#929c96]">({item.count})</span></span><strong className="tabular-nums text-[#26372e]">{currency(item.amount)}</strong></div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#f1f3ed]" role="img" aria-label={`${item.label}: ${currency(item.amount)}, ${item.count} títulos`}>
              <div className="h-full rounded-full bg-[#c58d30]" style={{ width: `${data.pending.amount > 0 ? item.amount / data.pending.amount * 100 : 0}%` }} />
            </div>
          </div>)}
        </div>
      </article>
    </section>

    <section className="surface-card rounded-[24px] p-5 md:p-6">
      <h3 className="text-sm font-semibold text-[#26372e]">Como ler os valores</h3>
      <div className="mt-3 grid gap-4 text-xs leading-6 text-[#718078] md:grid-cols-3">
        <p><strong className="text-[#53645a]">Para renegociar:</strong> posição atual da régua, filtrada pelo vencimento. Este gráfico mostra a distribuição da carteira de hoje; não é um histórico do saldo que existia em cada mês.</p>
        <p><strong className="text-[#53645a]">Dívida renegociada:</strong> saldo do título original quando a renegociação é concluída. Não representa o valor do novo acordo nem o dinheiro recebido.{data.renegotiated.historicalCount > 0 ? ` ${data.renegotiated.historicalCount} registro(s) antigo(s) usam o valor original do título, pois ainda não guardavam o saldo na data da renegociação.` : ""}</p>
        <p><strong className="text-[#53645a]">Quitados:</strong> valor pago de cada boleto com baixa confirmada no Clinicorp, a partir de D+3 dias úteis de atraso. Cada título entra uma vez, no mês do pagamento registrado na baixa. Não atribui o resultado a uma pessoa. Os três indicadores não devem ser somados.</p>
      </div>
      <details open className="mt-5 border-t border-[#e7ebe7] pt-4">
        <summary className="cursor-pointer text-sm font-medium text-[#39704a]">Valores por mês</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Valores e quantidades por mês, com a mesma base dos gráficos.</caption>
            <thead><tr className="border-b border-[#e7ebe7] text-[#718078]"><th scope="col" className="py-3 pr-4">Mês</th><th scope="col" className="px-3 py-3">Para renegociar</th><th scope="col" className="px-3 py-3">Dívida renegociada</th><th scope="col" className="px-3 py-3">Quitados em atraso</th></tr></thead>
            <tbody>{data.monthly.map((row) => <tr key={row.month} className="border-b border-[#eef1eb] text-[#405148]">
              <th scope="row" className="whitespace-nowrap py-3 pr-4 font-medium">{analyticsMonthLabel(row.month)}</th>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">{currency(row.pending)} · {row.pendingCount} títulos</td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">{currency(row.renegotiated)} · {row.renegotiatedCount} títulos</td>
              <td className="whitespace-nowrap px-3 py-3 tabular-nums">{currency(row.received)} · {row.receivedCount} títulos</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  </div>;
}

function AnalyticsMetric({ label, amount, count, detail, icon: Icon, tone }: {
  label: string; amount: number; count: string; detail: string; icon: typeof WalletCards; tone: string;
}) {
  return <article className="surface-card min-w-0 rounded-[22px] p-5">
    <div className={`grid size-10 place-items-center rounded-2xl ${tone}`}><Icon className="size-5" /></div>
    <p className="mt-5 text-sm text-[#68766e]">{label}</p>
    <p className="font-display mt-2 break-words text-[28px] font-semibold leading-tight tracking-tight text-[#1a2b22] tabular-nums">{currency(amount)}</p>
    <p className="mt-2 text-xs font-medium text-[#53645a]">{count}</p>
    <p className="mt-3 text-xs leading-5 text-[#87928c]">{detail}</p>
  </article>;
}

function MonthlyChart({ title, description, data, dataKey, label, color, line = false }: {
  title: string; description: string; data: CollectionAnalytics["monthly"];
  dataKey: "pending" | "renegotiated" | "received"; label: string; color: string; line?: boolean;
}) {
  const hasValues = data.some((row) => row[dataKey] > 0);
  const minimumWidth = Math.max(320, data.length * 80 + 110);
  const valueLabels = <LabelList dataKey={dataKey} position="top" offset={10}
    formatter={(value) => currency(Number(value))} fill="#26372e" fontSize={11} fontWeight={600} />;
  const axes = <>
    <CartesianGrid stroke="#e9eee7" vertical={false} />
    <XAxis dataKey="month" tickFormatter={analyticsMonthLabel} tick={{ fontSize: 11, fill: "#849087" }} axisLine={false} tickLine={false} minTickGap={18} dy={8} />
    <YAxis tickFormatter={compactCurrency} tick={{ fontSize: 10, fill: "#849087" }} axisLine={false} tickLine={false} width={65} domain={[0, "auto"]} />
    <Tooltip formatter={(value) => currency(Number(value))} labelFormatter={(value) => analyticsMonthLabel(String(value))} contentStyle={tooltipStyle} cursor={line ? undefined : { fill: "#f5f7f1" }} />
  </>;
  return <figure className="surface-card min-w-0 rounded-[24px] p-5 md:p-6" aria-label={title}>
    <figcaption><h3 className="font-display text-lg font-semibold text-[#192820]">{title}</h3><p className="mt-1 min-h-12 text-sm leading-6 text-[#718078]">{description}</p></figcaption>
    <div className="mt-5 overflow-x-auto rounded-xl pb-2" tabIndex={0} role="region" aria-label={`Gráfico de ${label}, com valores sempre visíveis`}>
      <div className="h-72 w-full" style={{ minWidth: minimumWidth }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: minimumWidth, height: 288 }}>
          {line ? <LineChart accessibilityLayer data={data} margin={{ top: 36, right: 44, bottom: 8, left: 8 }}>{axes}<Line dataKey={dataKey} name={label} type="linear" stroke={color} strokeWidth={3} dot={{ r: 4, fill: color }} isAnimationActive={false}>{valueLabels}</Line></LineChart>
            : <BarChart accessibilityLayer data={data} margin={{ top: 36, right: 44, bottom: 8, left: 8 }}>{axes}<Bar dataKey={dataKey} name={label} fill={color} radius={[6, 6, 0, 0]} maxBarSize={46} minPointSize={2} isAnimationActive={false}>{valueLabels}</Bar></BarChart>}
        </ResponsiveContainer>
      </div>
    </div>
    {!hasValues ? <p className="mt-2 text-xs leading-5 text-[#87928c]">{dataKey === "pending" ? "Sem valores conferidos neste período." : "Nenhum valor registrado neste período."}</p> : null}
    <p className="mt-2 text-[11px] text-[#87928c]">Valores em reais. Em telas menores, deslize o gráfico para ver todos os meses.</p>
  </figure>;
}
