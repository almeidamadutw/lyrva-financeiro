export type ParsedNfPatient = {
  name: string;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  clinicorpId?: string | null;
  unit: string;
  treatment?: string | null;
  paymentMethod: "Cartão" | "Boleto" | "Misto";
  sourceSystem?: "Clinicorp" | "Saúde Service" | "Misto" | "Planilha";
  recordType: "financial_plan" | "patient_directory";
  planAmountCents: number;
  installmentAmountCents: number;
  installments: number | null;
  startDate: string | null;
  endDate?: string | null;
  dueDay?: number | null;
  taxReceiptIr: boolean;
  invoiceScheduleMode: "automatic" | "manual";
  firstInvoiceDate?: string | null;
  invoiceIntervalMonths: number;
  invoiceStatus?: string | null;
  invoiceIssuedDate?: string | null;
  invoiceIssuedAmountCents?: number | null;
  invoiceRecipientName?: string | null;
  invoiceDisabled: boolean;
  invoiceDisabledReason?: string | null;
  notes?: string | null;
  source: "import";
  importKey: string;
  sourceSheet: string;
  sourceRow: number;
  reviewReason?: string | null;
};

export type NfWorkbookParseResult = {
  rows: ParsedNfPatient[];
  sheets: string[];
  readyCount: number;
  reviewCount: number;
  explicitUnitCount: number;
  unitlessCount: number;
};

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function moneyNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw) return null;
  const cleaned = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isoFromParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value: unknown, XLSX: typeof import("xlsx")) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return isoFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const decoded = XLSX.SSF.parse_date_code(value);
    if (decoded) return isoFromParts(decoded.y, decoded.m, decoded.d);
  }

  const raw = text(value);
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return isoFromParts(Number(match[1]), Number(match[2]), Number(match[3]));

  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return isoFromParts(Number(match[3]), Number(match[2]), Number(match[1]));

  // Corrige ocorrências da planilha recuperada como 09/052026.
  match = raw.match(/^(\d{2})\/(\d{2})(\d{4})$/);
  if (match) return isoFromParts(Number(match[3]), Number(match[2]), Number(match[1]));

  return null;
}

function addMonthsClamped(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoFromParts(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(day, lastDay));
}

function splitNameAnnotation(rawName: string) {
  const match = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) return { name: rawName.trim(), annotation: "" };
  const annotation = match[2].trim();
  const looksOperational = /(nf|nota|nome|pai|mae|mãe|marido|esposa|irma|irmã|irmao|irmão|pix|emitir|m[eê]s)/i.test(annotation);
  return looksOperational
    ? { name: match[1].trim(), annotation }
    : { name: rawName.trim(), annotation: "" };
}

function cleanLegacyPatientName(rawName: string) {
  let value = text(rawName);
  value = value.replace(/\s+\b(?:pago|paga|quitado|quitada)\b\s*$/i, "");
  value = value.replace(/\s+\d+\s*\/\s*\d+\s*(?:\([^)]*\))?\s*$/i, "");
  value = value.replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/i, "");
  return splitNameAnnotation(value).name.trim();
}

function detectUnit(note: string) {
  const key = normalize(note);
  if (key.includes("saltodepirapora") || key.includes("salto")) return "Salto de Pirapora";
  if (key.includes("sorocaba")) return "Sorocaba";
  return "";
}

function recipientFromNote(note: string) {
  const match = note.match(/nome\s+da\s+m[aã]e\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,60})/i);
  return match?.[1]?.trim() || null;
}

function shouldDisableInvoice(note: string) {
  return /(n[aã]o\s+emitir\s+(nota|nf)|sem\s+nota\s+fiscal)/i.test(note);
}

function isPatientHeader(value: unknown) {
  const key = normalize(value);
  return key === "paciente" || key === "nome" || key === "nomecompleto" || key === "coluna1";
}

function findDetailedHeaderIndex(rows: unknown[][]) {
  const max = Math.min(rows.length, 12);
  for (let index = 0; index < max; index += 1) {
    const row = rows[index] ?? [];
    if (!isPatientHeader(row[0])) continue;
    const second = normalize(row[1]);
    const third = normalize(row[2]);
    if ((second.includes("datadavenda") || second.includes("1parcela")) && third.includes("parcel")) return index;
  }
  return -1;
}

function findLegacyHeaderIndex(rows: unknown[][]) {
  const max = Math.min(rows.length, 12);
  for (let index = 0; index < max; index += 1) {
    const row = rows[index] ?? [];
    const left = isPatientHeader(row[0]) && normalize(row[2]).includes("valordanota");
    const right = isPatientHeader(row[7]) && normalize(row[9]).includes("valordanota");
    if (left || right) return index;
  }
  return -1;
}

function paymentMethodFromSheet(sheetName: string): "Cartão" | "Boleto" | null {
  const key = normalize(sheetName);
  if (key.includes("boleto")) return "Boleto";
  if (key.includes("cartao")) return "Cartão";
  return null;
}

function detailedSourceSystem(paymentMethod: "Cartão" | "Boleto") {
  return "Clinicorp" as const;
}

function parseDetailedSheet(
  sheetName: string,
  rows: unknown[][],
  headerIndex: number,
  paymentMethod: "Cartão" | "Boleto",
  fileUnit: string,
  XLSX: typeof import("xlsx"),
) {
  const parsed: ParsedNfPatient[] = [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rawName = text(row[0]);
    if (!rawName) continue;

    const { name, annotation } = splitNameAnnotation(rawName);
    const observation = text(row[13]);
    const combinedNote = [annotation, observation].filter(Boolean).join(" • ");
    const startDate = parseDate(row[1], XLSX);
    const installments = positiveInteger(row[2]);
    const installmentValue = moneyNumber(row[3]);
    const installmentAmountCents = installmentValue ? Math.round(installmentValue * 100) : 0;
    const planAmountCents = installments && installmentAmountCents ? installments * installmentAmountCents : 0;
    const endDate = startDate && installments ? addMonthsClamped(startDate, installments - 1) : null;
    const invoiceStatus = text(row[10]).toUpperCase() || null;
    const invoiceIssuedDate = parseDate(row[11], XLSX);
    const issuedValue = moneyNumber(row[12]);
    const invoiceIssuedAmountCents = issuedValue !== null ? Math.round(issuedValue * 100) : null;
    const invoiceDisabled = shouldDisableInvoice(combinedNote);
    const unit = detectUnit(combinedNote) || fileUnit;
    const review: string[] = [];

    if (!startDate) review.push("data da 1ª parcela");
    if (!installments) review.push("nº de parcelas");
    if (!installmentAmountCents) review.push("valor da parcela");
    if (/\bpix\b/i.test(combinedNote)) review.push("forma de pagamento indicada como PIX na observação");
    if (invoiceStatus === "EMITIDA" && !invoiceIssuedDate) review.push("NF marcada como emitida sem data real");

    const importKey = [
      "nf-workbook",
      normalize(name),
      startDate ?? "semdata",
      paymentMethod === "Boleto" ? "boleto" : "card",
      String(installments ?? 0),
      String(installmentAmountCents),
    ].join("|");

    parsed.push({
      name,
      unit,
      paymentMethod,
      sourceSystem: detailedSourceSystem(paymentMethod),
      recordType: "financial_plan",
      planAmountCents,
      installmentAmountCents,
      installments,
      startDate,
      endDate,
      dueDay: startDate ? Number(startDate.slice(-2)) : null,
      taxReceiptIr: !invoiceDisabled,
      invoiceScheduleMode: "automatic",
      invoiceIntervalMonths: 12,
      invoiceStatus,
      invoiceIssuedDate,
      invoiceIssuedAmountCents,
      invoiceRecipientName: recipientFromNote(combinedNote),
      invoiceDisabled,
      invoiceDisabledReason: invoiceDisabled ? combinedNote || "Não emitir nota fiscal" : null,
      notes: combinedNote || null,
      source: "import",
      importKey,
      sourceSheet: sheetName,
      sourceRow: index + 1,
      reviewReason: review.length ? review.join(", ") : null,
    });
  }

  return parsed;
}

function legacyNote(
  sourceSystem: "Clinicorp",
  paymentMethod: "Cartão" | "Boleto",
  row: unknown[],
  offset: number,
  sheetName: string,
) {
  const amount = moneyNumber(row[offset + 2]);
  const status = text(row[offset + 3]);
  const received = text(row[offset + 1]);
  const sent = text(row[offset + 4]);
  const pieces = [
    `Conciliação: ${sourceSystem} / ${paymentMethod}`,
    `Planilha: ${sheetName}`,
    amount !== null ? `Valor da NF no período: R$ ${amount.toFixed(2).replace(".", ",")}` : "",
    status ? `Status: ${status}` : "",
    received ? `Recebimento: ${received}` : "",
    sent ? `Envio: ${sent}` : "",
  ].filter(Boolean);
  return pieces.join(" • ");
}

function parseLegacyBlock(
  sheetName: string,
  rows: unknown[][],
  headerIndex: number,
  offset: number,
  paymentMethod: "Cartão" | "Boleto",
  sourceSystem: "Clinicorp",
  fileUnit: string,
) {
  const parsed: ParsedNfPatient[] = [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rawName = text(row[offset]);
    if (!rawName || isPatientHeader(rawName)) continue;
    const key = normalize(rawName);
    if (!key || key.startsWith("total") || key.startsWith("soma")) continue;

    const name = cleanLegacyPatientName(rawName);
    if (name.length < 2) continue;

    const invoiceStatus = text(row[offset + 3]).toUpperCase() || null;
    const note = legacyNote(sourceSystem, paymentMethod, row, offset, sheetName);
    const unit = fileUnit || detectUnit(note);

    parsed.push({
      name,
      unit,
      paymentMethod,
      sourceSystem,
      recordType: "patient_directory",
      planAmountCents: 0,
      installmentAmountCents: 0,
      installments: null,
      startDate: null,
      endDate: null,
      dueDay: null,
      taxReceiptIr: true,
      invoiceScheduleMode: "automatic",
      invoiceIntervalMonths: 12,
      invoiceStatus,
      invoiceIssuedDate: null,
      invoiceIssuedAmountCents: null,
      invoiceRecipientName: null,
      invoiceDisabled: false,
      invoiceDisabledReason: null,
      notes: note,
      source: "import",
      importKey: ["patient-directory", normalize(name), normalize(unit || "sem-unidade")].join("|"),
      sourceSheet: sheetName,
      sourceRow: index + 1,
      reviewReason: null,
    });
  }

  return parsed;
}

function mergeDirectoryRows(rows: ParsedNfPatient[]) {
  const result: ParsedNfPatient[] = [];
  const byKey = new Map<string, number>();

  for (const row of rows) {
    if (row.recordType !== "patient_directory") {
      result.push(row);
      continue;
    }

    const key = `${normalize(row.name)}|${normalize(row.unit || "sem-unidade")}`;
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, result.length);
      result.push(row);
      continue;
    }

    const existing = result[existingIndex];
    const mixedSource = existing.sourceSystem !== row.sourceSystem;
    result[existingIndex] = {
      ...existing,
      paymentMethod: mixedSource ? "Misto" : row.paymentMethod,
      sourceSystem: mixedSource ? "Misto" : row.sourceSystem,
      invoiceStatus: row.invoiceStatus || existing.invoiceStatus,
      notes: row.notes || existing.notes,
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
    };
  }

  return result;
}

export async function parseNfWorkbook(file: File): Promise<NfWorkbookParseResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const parsedRows: ParsedNfPatient[] = [];
  const recognizedSheets: string[] = [];
  const fileUnit = detectUnit(file.name);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });

    const paymentMethod = paymentMethodFromSheet(sheetName);
    const detailedHeaderIndex = paymentMethod ? findDetailedHeaderIndex(rows) : -1;
    if (paymentMethod && detailedHeaderIndex >= 0) {
      parsedRows.push(...parseDetailedSheet(sheetName, rows, detailedHeaderIndex, paymentMethod, fileUnit, XLSX));
      recognizedSheets.push(sheetName);
      continue;
    }

    const legacyHeaderIndex = findLegacyHeaderIndex(rows);
    if (legacyHeaderIndex < 0) continue;

    const header = rows[legacyHeaderIndex] ?? [];
    let foundLegacyBlock = false;

    // Regra operacional da planilha usada pela equipe:
    // esquerda = Boleto; direita = Cartão. As baixas dos dois são conciliadas pelo Clinicorp.
    if (isPatientHeader(header[0]) && normalize(header[2]).includes("valordanota")) {
      parsedRows.push(...parseLegacyBlock(sheetName, rows, legacyHeaderIndex, 0, "Boleto", "Clinicorp", fileUnit));
      foundLegacyBlock = true;
    }
    if (isPatientHeader(header[7]) && normalize(header[9]).includes("valordanota")) {
      parsedRows.push(...parseLegacyBlock(sheetName, rows, legacyHeaderIndex, 7, "Cartão", "Clinicorp", fileUnit));
      foundLegacyBlock = true;
    }

    if (foundLegacyBlock) recognizedSheets.push(sheetName);
  }

  const mergedRows = mergeDirectoryRows(parsedRows);

  if (!recognizedSheets.length) {
    throw new Error("Não encontrei o modelo detalhado nem o modelo mensal com Boleto à esquerda e Cartão à direita.");
  }

  const readyCount = mergedRows.filter((row) => (
    row.recordType === "patient_directory"
      ? Boolean(row.name)
      : !row.reviewReason && Boolean(row.startDate) && Boolean(row.installments) && row.installmentAmountCents > 0
  )).length;
  const explicitUnitCount = mergedRows.filter((row) => Boolean(row.unit)).length;

  return {
    rows: mergedRows,
    sheets: [...new Set(recognizedSheets)],
    readyCount,
    reviewCount: mergedRows.length - readyCount,
    explicitUnitCount,
    unitlessCount: mergedRows.length - explicitUnitCount,
  };
}
