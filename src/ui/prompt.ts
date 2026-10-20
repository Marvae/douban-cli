import readline from 'node:readline/promises';
import { stdin, stderr } from 'node:process';

/** Whether someone can answer a prompt: both stdin and stdout are terminals. */
export function canPrompt(): boolean {
  return Boolean(stdin.isTTY && process.stdout.isTTY);
}

/** Ask on stderr so stdout keeps only results; returns the trimmed answer. */
export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
