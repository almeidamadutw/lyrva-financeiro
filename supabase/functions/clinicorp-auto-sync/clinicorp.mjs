function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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
  return isRecord(row);
}

export function eligibleAutomaticPayments(rows) {
  const byExternalId = new Map();
  for (const row of rows) {
    if (!isEligibleAutomaticPayment(row)) continue;
    byExternalId.set(externalPaymentId(row) ?? `derived:${paymentFingerprint(row)}`, row);
  }
  return [...byExternalId.values()];
}

export function paymentFingerprint(row) {
  return JSON.stringify(canonicalize(row ?? null));
}

export function paymentChanged(row, existingRawData) {
  return paymentFingerprint(row) !== paymentFingerprint(existingRawData);
}
