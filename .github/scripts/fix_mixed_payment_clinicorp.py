from pathlib import Path

path = Path('lib/nf-workbook.ts')
text = path.read_text(encoding='utf-8')
old = '''    const existing = result[existingIndex];
    const mixedSource = existing.sourceSystem !== row.sourceSystem;
    result[existingIndex] = {
      ...existing,
      paymentMethod: mixedSource ? "Misto" : row.paymentMethod,
      sourceSystem: mixedSource ? "Misto" : row.sourceSystem,'''
new = '''    const existing = result[existingIndex];
    const mixedPayment = existing.paymentMethod !== row.paymentMethod;
    const mixedSource = existing.sourceSystem !== row.sourceSystem;
    result[existingIndex] = {
      ...existing,
      paymentMethod: mixedPayment ? "Misto" : row.paymentMethod,
      sourceSystem: mixedSource ? "Misto" : row.sourceSystem,'''
if old not in text:
    raise SystemExit('Trecho de mesclagem não encontrado')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
