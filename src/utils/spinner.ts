const FRAMES = ['|', '/', '-', '\\'];

function canUseSpinner(): boolean {
  return Boolean(process.stderr.isTTY) && process.env.CI !== 'true' && process.env.NO_COLOR !== '1';
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>, enabled = true): Promise<T> {
  // 请求通常很快，不显示 spinner
  return fn();
}
