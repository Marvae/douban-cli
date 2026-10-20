/**
 * Quote a CSV cell. Values that a spreadsheet would run as a formula
 * (starting with =, +, - or @, after any BOM or spaces) get a leading quote.
 */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const probe = text.replace(/^\uFEFF+/, '').trimStart();
  const safe = /^[=+\-@]/.test(probe) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}
