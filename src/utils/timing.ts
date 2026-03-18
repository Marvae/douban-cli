export function parseDelaySeconds(value: string | undefined, fallback = Number.NaN): number {
  if (typeof value === 'undefined' || value.trim() === '') return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('--delay 必须是非负数字');
  }
  return parsed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
