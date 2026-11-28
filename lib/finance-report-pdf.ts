import type { PDFFont, PDFPage } from "pdf-lib";

export type FinanceReport = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  filename: string;
};

export async function downloadFinanceReport({ title, subtitle, columns, rows, filename }: FinanceReport) {
  if (!columns.length || rows.some(row => row.length !== columns.length)) {
    throw new Error("Confira as colunas e as linhas do relatório.");
  }
  const { PDFDocument, PageSizes, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const [body, bold] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold),
  ]);
  const supported = new Set(body.getCharacterSet());
  const [short, long] = PageSizes.A4;
  const [width, height] = columns.length >= 5 ? [long, short] : [short, long];
  const margin = 32, bottom = 44, cellPad = 5, lineHeight = 13, fontSize = 9.5;
  const contentWidth = width - 2 * margin;
  const ink = rgb(0.08, 0.17, 0.14), muted = rgb(0.29, 0.33, 0.39);
  const rule = rgb(0.79, 0.81, 0.84), headerFill = rgb(0.89, 0.96, 0.92);
  const generated = new Date();
  const timestamp = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
  }).format(generated);
  pdf.setTitle(title);
  pdf.setLanguage("pt-BR");
  pdf.setCreationDate(generated);

  // Portuguese accents are in Helvetica's WinAnsi repertoire. Keep the code point
  // visible for characters outside it so individual names stay distinguishable.
  function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
    const lines: string[] = [];
    for (const paragraph of text.normalize("NFC").split(/\r\n|[\r\n]/)) {
      const safe = Array.from(paragraph, char => {
        if (/\s/.test(char)) return " ";
        const n = char.codePointAt(0)!;
        return supported.has(n) ? char : `[U+${n.toString(16).toUpperCase()}]`;
      }).join("");
      let line = "";
      for (const word of safe.trim().split(/\s+/)) {
        const candidate = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        for (const char of word) {
          if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  const sample = rows.slice(0, 100);
  const weights = columns.map((label, i) => {
    const lengths = sample.map(row => row[i].length).sort((a, b) => a - b);
    return Math.max(8, Math.min(45, Math.max(label.length, lengths[Math.floor(lengths.length * 0.8)] ?? 0)));
  });
  const totalWeight = weights.reduce((sum, n) => sum + n, 0);
  const widths = weights.map(weight => contentWidth * weight / totalWeight);
  const headers = columns.map((label, i) => wrap(label, bold, fontSize, widths[i] - 2 * cellPad));
  const headerLines = Math.max(...headers.map(lines => lines.length));
  const bandHeight = headerLines * lineHeight + 2 * cellPad;
  if (widths.some(w => w < 2 * cellPad + fontSize) || bandHeight > height - margin - bottom - 2 * cellPad - lineHeight) {
    throw new Error("As colunas não cabem em uma folha A4.");
  }

  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - margin;
  function newPage() {
    page = pdf.addPage([width, height]);
    y = height - margin;
  }
  function heading(text: string, font: PDFFont, size: number) {
    for (const line of wrap(text, font, size, contentWidth)) {
      if (y - size - 5 < bottom) newPage();
      page.drawText(line, { x: margin, y: y - size, font, size, color: ink });
      y -= size + 5;
    }
  }
  function cells(values: string[][], offset: number, count: number, isHeader = false) {
    const h = count * lineHeight + 2 * cellPad;
    if (isHeader) page.drawRectangle({ x: margin, y: y - h, width: contentWidth, height: h, color: headerFill });
    let x = margin + cellPad;
    values.forEach((lines, i) => {
      lines.slice(offset, offset + count).forEach((line, index) => {
        page.drawText(line, { x, y: y - cellPad - fontSize - index * lineHeight, font: isHeader ? bold : body, size: fontSize, color: ink });
      });
      x += widths[i];
    });
    y -= h;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rule });
  }
  function nextTablePage() {
    newPage();
    cells(headers, 0, headerLines, true);
  }
  heading("LYVRA  /  FINANCEIRO", bold, 10);
  heading(title, bold, 17);
  if (subtitle) heading(subtitle, body, 10);
  heading(`${rows.length.toLocaleString("pt-BR")} ${rows.length === 1 ? "registro" : "registros"}`, bold, 10);
  y -= 7;
  if (y - bandHeight - 2 * cellPad - lineHeight < bottom) newPage();
  cells(headers, 0, headerLines, true);
  const freshCapacity = Math.floor((height - margin - bandHeight - bottom - 2 * cellPad) / lineHeight);
  for (const row of rows) {
    const values = row.map((value, i) => wrap(value || "—", body, fontSize, widths[i] - 2 * cellPad));
    const lines = Math.max(...values.map(cell => cell.length));
    // Keep regular records together. Split an exceptionally long record across
    // as many pages as needed, reserving the footer and repeating the column names.
    if (lines <= freshCapacity && y - lines * lineHeight - 2 * cellPad < bottom) nextTablePage();
    let offset = 0;
    while (offset < lines) {
      const fits = Math.floor((y - bottom - 2 * cellPad) / lineHeight);
      if (fits < 1) { nextTablePage(); continue; }
      const count = Math.min(fits, lines - offset);
      cells(values, offset, count);
      offset += count;
    }
  }
  const pages = pdf.getPages();
  for (const [index, sheet] of pages.entries()) {
    const number = `Página ${index + 1} de ${pages.length}`;
    sheet.drawText(`Emitido em ${timestamp} · Brasília`, { x: margin, y: 23, size: 8, font: body, color: muted });
    sheet.drawText(number, { x: width - margin - body.widthOfTextAtSize(number, 8), y: 23, size: 8, font: body, color: muted });
  }

  const bytes = await pdf.save();
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = /\.pdf$/i.test(filename) ? filename : filename + ".pdf";
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
