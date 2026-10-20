/** Terminal column width: CJK and emoji take two columns. */
export function getDisplayWidth(text: string): number {
  let width = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    if (
      (code >= 0x1f300 && code <= 0x1f5ff) ||
      (code >= 0x1f600 && code <= 0x1f64f) ||
      (code >= 0x1f680 && code <= 0x1f6ff) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x1fa70 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf)
    ) {
      width += 2;
      continue;
    }

    if (
      (code >= 0x1100 && code <= 0x115f) ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
      continue;
    }

    width += 1;
  }

  return width;
}

/** Pad to a terminal column width, counting CJK and emoji as two columns. */
export function padDisplayEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - getDisplayWidth(text)));
}

/** Cut text to a terminal column width, ending with "…" when shortened. */
export function truncateDisplay(text: string, maxWidth: number): string {
  if (getDisplayWidth(text) <= maxWidth) return text;
  let result = '';
  let width = 0;
  for (const char of text) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth > maxWidth - 1) break;
    result += char;
    width += charWidth;
  }
  return `${result}…`;
}
