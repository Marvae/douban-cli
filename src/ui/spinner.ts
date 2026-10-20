const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

function renderLine(content: string): void {
  process.stderr.write(`\r\x1b[2K${content}`);
}

/** `text` may be a function so long tasks can show live progress. */
export async function withSpinner<T>(text: string | (() => string), fn: () => Promise<T>, enabled = true): Promise<T> {
  if (!enabled || !process.stderr.isTTY) return fn();
  const label = () => (typeof text === 'function' ? text() : text);

  let frameIndex = 0;
  const timer = setInterval(() => {
    const frame = FRAMES[frameIndex % FRAMES.length];
    frameIndex += 1;
    renderLine(`${frame} ${label()}`);
  }, SPINNER_INTERVAL_MS);

  try {
    renderLine(`${FRAMES[0]} ${label()}`);
    const result = await fn();
    clearInterval(timer);
    process.stderr.write('\r\x1b[2K');
    return result;
  } catch (error) {
    clearInterval(timer);
    renderLine(`✖ ${label()}`);
    process.stderr.write('\n');
    throw error;
  }
}
