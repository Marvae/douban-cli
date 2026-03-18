export async function withSpinner<T>(text: string, fn: () => Promise<T>, enabled = true): Promise<T> {
  return fn();
}
