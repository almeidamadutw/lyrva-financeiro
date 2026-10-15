const WRAPPERS = ["data", "Data", "items", "Items", "results", "Results"];
const LOCAL_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",
});

/** Clinicorp filters local creation days but returns PostDate timestamps in UTC.
 * @param {unknown} value
 */
export function sourcePostingDay(value) {
  const text=String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return "";
  const timestamp=new Date(text);
  return Number.isFinite(timestamp.getTime()) ? LOCAL_DAY.format(timestamp) : "";
}

/** Cover a stored UTC date with two exact local-day requests.
 * @param {string} storedDate
 */
export function postingDaysForStoredDate(storedDate) {
  const date=new Date(`${storedDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(storedDate) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0,10)!==storedDate) throw new Error("Data de lançamento inválida.");
  date.setUTCDate(date.getUTCDate()-1);
  return [date.toISOString().slice(0,10),storedDate];
}

/** Read-only diagnostics contain dates and counts, never patient data.
 * @param {unknown} payload
 * @param {string} postDate
 */
export function summarizePostDatePayload(payload, postDate) {
  let values = payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const object = /** @type {Record<string, unknown>} */ (payload);
    const wrapper = WRAPPERS.find((key) => Array.isArray(object[key]));
    values = wrapper ? object[wrapper] : [object];
  }
  const rows = Array.isArray(values) ? values.filter((r) => r && typeof r === "object" && !Array.isArray(r)) : [];
  const dates = new Map();
  for (const row of rows) {
    const timestamp = String(row.PostDate ?? "").slice(0, 35);
    const key = timestamp.slice(0, 10);
    const value = dates.get(key) ?? {date:key,rows:0,sampleTimestamp:timestamp};
    value.rows += 1;
    dates.set(key,value);
  }
  return {
    returnedRows:rows.length,
    missingIdentifiers:rows.filter((r) => !sourceRowId(r)).length,
    missingPaymentForms:rows.filter((r) => typeof r.PaymentForm !== "string" || !r.PaymentForm.trim()).length,
    matchingDateRows:rows.filter((r) => String(r.PostDate ?? "").slice(0,10) === postDate).length,
    dates:[...dates.values()],
  };
}

/** @param {Record<string, unknown>} row */
export function sourceRowId(row) {
  return String(row.id ?? "").trim() || String(row.ExternalTxId ?? "").trim();
}

/**
 * An HTTP 200 error or incomplete row must never be treated as an absent debt.
 * @param {unknown} payload
 * @param {string} postDate
 * @returns {Record<string, unknown>[]}
 */
export function normalizePostDateRows(payload, postDate) {
  let rows = payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const object = /** @type {Record<string, unknown>} */ (payload);
    if (object.error || object.Error || object.ok === false || object.success === false) {
      throw new Error("O Clinicorp retornou um erro na consulta de parcelas.");
    }
    const wrapper = WRAPPERS.find((key) => Array.isArray(object[key]));
    rows = wrapper ? object[wrapper] : [object];
  }
  if (!Array.isArray(rows)) {
    throw new Error("O Clinicorp não retornou uma lista válida de parcelas.");
  }
  const byId = new Map();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("O Clinicorp retornou uma parcela incompleta.");
    }
    const row = /** @type {Record<string, unknown>} */ (value);
    const id = sourceRowId(row);
    if (!id) throw new Error("O Clinicorp retornou uma parcela sem identificador.");
    if (typeof row.PaymentForm !== "string" || !row.PaymentForm.trim()) {
      throw new Error("O Clinicorp retornou uma parcela sem forma de pagamento.");
    }
    if (sourcePostingDay(row.PostDate) !== postDate) {
      const receivedDay = String(row.PostDate ?? "").slice(0, 10);
      throw new Error(`O Clinicorp retornou uma parcela com data de lançamento ${receivedDay || "ausente"}; esperada ${postDate}.`);
    }
    const previous = byId.get(id);
    if (previous && ["PaymentForm", "PaymentReceived", "PaymentConfirmed", "Canceled",
      "CancelInstallment", "ExternalStatus", "Amount", "DueDate"]
      .some((key) => String(previous[key] ?? "") !== String(row[key] ?? ""))) {
      throw new Error("O Clinicorp retornou estados conflitantes para a mesma parcela.");
    }
    byId.set(id, row);
  }
  return [...byId.values()];
}
