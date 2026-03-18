function parseStrictInteger(rawValue: string, optionName: string): number {
  const trimmed = rawValue.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} 必须是整数`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} 超出安全整数范围`);
  }

  return parsed;
}

export function parseNonNegativeInt(value: string | undefined, optionName: string, fallback: number): number {
  if (typeof value === 'undefined') return fallback;
  const parsed = parseStrictInteger(value, optionName);
  if (parsed < 0) {
    throw new Error(`${optionName} 必须是非负整数`);
  }
  return parsed;
}

export function parsePositiveInt(value: string | undefined, optionName: string, fallback: number): number {
  if (typeof value === 'undefined') return fallback;
  const parsed = parseStrictInteger(value, optionName);
  if (parsed <= 0) {
    throw new Error(`${optionName} 必须是正整数`);
  }
  return parsed;
}

export function isNumericId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

export function formEncode(data: Record<string, string | undefined | null>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    body.set(key, value);
  }
  return body.toString();
}
