function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeForMatch(value) {
  return safeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function normalizeClinicorpRows(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of ["data", "Data", "items", "Items", "results", "Results"]) {
    if (Array.isArray(payload[key])) return payload[key].filter(isRecord);
  }

  return [payload];
}

export function externalPaymentId(row) {
  return safeString(row?.ExternalTxId) || safeString(row?.id) || null;
}

export function isEligibleAutomaticPayment(row) {
  if (!isRecord(row)) return false;
  const method = normalizeForMatch(row.PaymentForm);
  return safeString(row.PaymentConfirmed).toUpperCase() === "X"
    && Boolean(safeString(row.ConfirmedDate))
    && Boolean(safeString(row.PatientId))
    && Boolean(externalPaymentId(row))
    && (method.includes("boleto") || method.includes("cartao"));
}

export function eligibleAutomaticPayments(rows) {
  const byExternalId = new Map();
  for (const row of rows) {
    if (!isEligibleAutomaticPayment(row)) continue;
    byExternalId.set(externalPaymentId(row), row);
  }
  return [...byExternalId.values()];
}

export function paymentFingerprint(row) {
  return JSON.stringify(canonicalize(row ?? null));
}

export function paymentChanged(row, existingRawData) {
  return paymentFingerprint(row) !== paymentFingerprint(existingRawData);
}
