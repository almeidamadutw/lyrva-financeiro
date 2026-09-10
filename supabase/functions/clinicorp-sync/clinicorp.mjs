export const CLINICORP_API_BASE = "https://api.clinicorp.com/rest/v1";

export const CLINICORP_SECRET_NAMES = Object.freeze({
  sorocaba: Object.freeze({
    username: "CLINICORP_SOROCABA_USERNAME",
    token: "CLINICORP_SOROCABA_TOKEN",
  }),
  salto_de_pirapora: Object.freeze({
    username: "CLINICORP_SALTO_USERNAME",
    token: "CLINICORP_SALTO_TOKEN",
  }),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 86_400_000;

export class ClinicorpApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "ClinicorpApiError";
    this.status = status;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asSafeString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 120) : null;
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedField(row, aliases) {
  const fields = new Map(
    Object.entries(row).map(([key, value]) => [normalizeForMatch(key), value]),
  );
  for (const alias of aliases) {
    const value = fields.get(normalizeForMatch(alias));
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function nestedRecords(value, depth = 0) {
  if (depth > 6) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => nestedRecords(item, depth + 1));
  }
  if (!isRecord(value)) return [];
  return [
    value,
    ...Object.values(value).flatMap((item) => (
      Array.isArray(item) || isRecord(item) ? nestedRecords(item, depth + 1) : []
    )),
  ];
}

function isLeafRecord(row) {
  return !Object.values(row).some((value) => Array.isArray(value) || isRecord(value));
}

export function normalizeClinicorpRows(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of ["data", "Data", "items", "Items", "results", "Results"]) {
    if (Array.isArray(payload[key])) return payload[key].filter(isRecord);
  }

  return [payload];
}

export function normalizeForMatch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function validateDateRange(from, to, maxDays = 31) {
  if (!ISO_DATE.test(from ?? "") || !ISO_DATE.test(to ?? "")) {
    throw new Error("Informe as datas no formato AAAA-MM-DD.");
  }

  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (
    !Number.isFinite(fromMs)
    || !Number.isFinite(toMs)
    || new Date(fromMs).toISOString().slice(0, 10) !== from
    || new Date(toMs).toISOString().slice(0, 10) !== to
  ) {
    throw new Error("Informe um período válido.");
  }
  if (toMs < fromMs) throw new Error("A data final deve ser igual ou posterior à inicial.");

  const days = Math.floor((toMs - fromMs) / DAY_IN_MS) + 1;
  if (days > maxDays) throw new Error(`A leitura inicial aceita no máximo ${maxDays} dias.`);
  return { from, to, days };
}

export function extractSubscriberCandidates(payload) {
  const rows = nestedRecords(payload);
  const candidates = rows.flatMap((row) => {
    const explicitId = normalizedField(row, [
      "SubscriberBussinessUID",
      "SubscriberBusinessUID",
      "SubscriberBusinessId",
      "SubscriberUID",
      "SubscriberId",
      "subscriber_id",
    ]);
    const name = asSafeString(normalizedField(row, [
      "SubscriberName",
      "SubscriberNamespace",
      "Namespace",
      "Name",
    ]));
    const fallbackId = name && isLeafRecord(row)
      ? normalizedField(row, ["id", "uid"])
      : null;
    const id = asSafeString(explicitId ?? fallbackId);
    if (!id) return [];
    return [{ id, name }];
  });

  return candidates.filter(
    (candidate, index) => candidates.findIndex((item) => item.id === candidate.id) === index,
  );
}

export function extractBusinessCandidates(payload) {
  const candidates = nestedRecords(payload).flatMap((row) => {
    const name = asSafeString(normalizedField(row, [
      "BusinessName",
      "CompanyName",
      "FantasyName",
      "Name",
    ]));
    const explicitId = normalizedField(row, [
      "BusinessUID",
      "BusinessId",
      "CompanyUID",
      "CompanyId",
      "business_id",
    ]);
    const fallbackId = name && isLeafRecord(row)
      ? normalizedField(row, ["id", "uid"])
      : null;
    const id = asSafeString(explicitId ?? fallbackId);
    if (!id) return [];
    return [{
      id,
      name: name ?? `Clínica ${id}`,
    }];
  });

  return candidates.filter(
    (candidate, index) => candidates.findIndex((item) => item.id === candidate.id) === index,
  );
}

export function selectBusiness(candidates, unitName, requestedBusinessId = null) {
  if (requestedBusinessId) {
    return candidates.find((candidate) => candidate.id === String(requestedBusinessId)) ?? null;
  }
  if (candidates.length === 1) return candidates[0];

  const unitKey = normalizeForMatch(unitName);
  const matches = candidates.filter((candidate) => {
    const candidateKey = normalizeForMatch(candidate.name);
    return candidateKey.includes(unitKey) || unitKey.includes(candidateKey);
  });
  return matches.length === 1 ? matches[0] : null;
}

function distinctValues(rows, key) {
  return [...new Set(rows.map((row) => asSafeString(row[key])).filter(Boolean))].slice(0, 20);
}

export function summarizePayments(payload) {
  const rows = normalizeClinicorpRows(payload);
  const patientIds = new Set();
  let totalAmount = 0;
  let rowsWithDueDate = 0;
  let rowsWithReceivedDate = 0;
  let rowsWithConfirmedDate = 0;

  for (const row of rows) {
    const patientId = asSafeString(row.PatientId);
    if (patientId) patientIds.add(patientId);
    if (asSafeString(row.DueDate)) rowsWithDueDate += 1;
    if (asSafeString(row.ReceivedDate ?? row.PaymentDate)) rowsWithReceivedDate += 1;
    if (asSafeString(row.ConfirmedDate)) rowsWithConfirmedDate += 1;
    totalAmount += asFiniteNumber(row.Amount) ?? 0;
  }

  const fieldNames = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const sample = rows.slice(0, 3).map((row) => ({
    id: asSafeString(row.id),
    patientId: asSafeString(row.PatientId),
    paymentHeaderId: asSafeString(row.PaymentHeaderId),
    treatmentId: asSafeString(row.TreatmentId),
    dueDate: asSafeString(row.DueDate),
    receivedDate: asSafeString(row.ReceivedDate ?? row.PaymentDate),
    confirmedDate: asSafeString(row.ConfirmedDate),
    amount: asFiniteNumber(row.Amount),
    paymentReceived: asSafeString(row.PaymentReceived),
    paymentConfirmed: asSafeString(row.PaymentConfirmed),
    paymentForm: asSafeString(row.PaymentForm),
    installmentNumber: asSafeString(row.InstallmentNumber),
  }));

  return {
    totalRows: rows.length,
    uniquePatients: patientIds.size,
    totalAmount: Number(totalAmount.toFixed(2)),
    rowsWithDueDate,
    rowsWithReceivedDate,
    rowsWithConfirmedDate,
    paymentReceivedValues: distinctValues(rows, "PaymentReceived"),
    paymentConfirmedValues: distinctValues(rows, "PaymentConfirmed"),
    paymentForms: distinctValues(rows, "PaymentForm"),
    fieldNames,
    sample,
  };
}

export async function clinicorpGet(path, query, credentials, fetchImpl = fetch) {
  const url = new URL(`${CLINICORP_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }

  const basicToken = btoa(`${credentials.username}:${credentials.token}`);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Basic ${basicToken}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ClinicorpApiError(
      error instanceof DOMException && error.name === "TimeoutError"
        ? "O Clinicorp demorou além do limite para responder."
        : "Não foi possível alcançar a API do Clinicorp.",
    );
  }

  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "O Clinicorp recusou o Usuário API ou o Token API desta unidade."
      : `O Clinicorp respondeu com erro HTTP ${response.status}.`;
    throw new ClinicorpApiError(message, response.status);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 6_000_000) {
    throw new ClinicorpApiError("A resposta do Clinicorp excedeu o limite da leitura inicial.");
  }

  const text = await response.text();
  if (text.length > 6_000_000) {
    throw new ClinicorpApiError("A resposta do Clinicorp excedeu o limite da leitura inicial.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ClinicorpApiError("O Clinicorp retornou uma resposta que não está em JSON.");
  }
}
