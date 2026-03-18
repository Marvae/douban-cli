export function parseNonNegativeInt(value: string | undefined, optionName: string, fallback: number): number {
  if (typeof value === 'undefined') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} 必须是非负整数`);
  }
  return parsed;
}

export function parsePositiveInt(value: string | undefined, optionName: string, fallback: number): number {
  if (typeof value === 'undefined') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} 必须是正整数`);
  }
  return parsed;
}

export function isNumericId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

export function formEncode(data: Record<string, string>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === '') continue;
    body.set(key, value);
  }
  return body.toString();
}
