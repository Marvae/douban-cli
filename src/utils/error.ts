type CommandErrorContext = {
  command: string;
  target?: string;
  options?: string;
  suggestion?: string;
};

type ErrorContextFactory<T extends unknown[]> = (args: T, error: unknown) => CommandErrorContext;

type CommanderErrorLike = Error & {
  code?: string;
  exitCode?: number;
};

export type CliErrorCode =
  | 'AUTH_REQUIRED'
  | 'COMMAND_FAILED'
  | 'HTTP_ERROR'
  | 'INVALID_ARGUMENT'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNKNOWN_COMMAND';

export type CliErrorPayload = {
  ok: false;
  error: {
    code: CliErrorCode;
    message: string;
    command: string;
    target?: string;
    suggestion?: string;
  };
};

export class CliArgumentError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliArgumentError';
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactSensitiveArguments(
  message: string,
  argv: readonly string[] = process.argv.slice(2)
): string {
  let redacted = message;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;

    const assignment = argument.match(/^(--cookie(?:-stdin)?=)/i);
    if (assignment) {
      redacted = redacted.replaceAll(argument, `${assignment[1]}[REDACTED]`);
      continue;
    }

    const previous = argv[index - 1]?.toLowerCase();
    const followsSensitiveOption = (
      previous === '--cookie' || previous === '--cookie-stdin'
    ) && !argument.startsWith('-');
    const containsAuthCookie = /(?:^|[;\s])(?:dbcl2|ck)\s*=/i.test(argument);
    if (followsSensitiveOption || containsAuthCookie) {
      redacted = redacted.replaceAll(argument, '[REDACTED]');
    }
  }

  return redacted.replace(
    /\b(dbcl2|ck)\s*=\s*(?:"[^"\r\n;]*"|'[^'\r\n;]*'|[^;\s'"\r\n]*)/gi,
    '$1=[REDACTED]'
  );
}

/** Commander reports parse errors in English; show them in the CLI's language. */
function translateCommanderMessage(message: string): string {
  const didYouMean = message.match(/\(Did you mean (.+?)\?\)/)?.[1];
  const hint = didYouMean ? `，你是不是想用 ${didYouMean}？` : '';
  const text = message.replace(/^error:\s*/, '');
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^unknown command '(.+?)'/))) return `未知命令：${match[1]}${hint}`;
  if ((match = text.match(/^unknown option '(.+?)'/))) return `未知选项：${match[1]}${hint}`;
  if ((match = text.match(/^missing required argument '(.+?)'/))) return `缺少参数 <${match[1]}>`;
  if ((match = text.match(/^required option '(.+?)' not specified/))) return `缺少必需选项 ${match[1]}`;
  if ((match = text.match(/^option '(.+?)' argument missing/))) return `选项 ${match[1]} 缺少取值`;
  if ((match = text.match(/^too many arguments(?: for '(.+?)')?\. Expected (\d+) arguments? but got (\d+)(?:: ([\s\S]*?))?\.?$/))) {
    const [, command, expected, received, extra] = match;
    return `参数过多：${command ? `${command} ` : '该命令'}需要 ${expected} 个参数，收到 ${received} 个${extra ? `：${extra}` : ''}`;
  }
  return text;
}

/** The command words the user typed, such as `book export`, up to the first option. */
function typedCommandPath(argv: readonly string[] = process.argv.slice(2)): string[] {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith('-')) break;
    words.push(token);
    if (words[0] !== 'book' || words.length === 2) break;
  }
  return words;
}

function isCommanderError(error: unknown): error is CommanderErrorLike {
  return error instanceof Error && 'code' in error && String((error as CommanderErrorLike).code).startsWith('commander.');
}

function structuredErrorCode(error: unknown): CliErrorCode | undefined {
  const visited = new Set<Error>();
  let current = error;

  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    const structuredCode = 'code' in current
      ? String((current as Error & { code?: unknown }).code || '')
      : '';
    const structuredStatus = 'status' in current
      ? Number((current as Error & { status?: unknown }).status)
      : Number.NaN;

    if (structuredCode === 'NETWORK') return 'NETWORK_ERROR';
    if (structuredCode === 'INVALID_ARGUMENT') return 'INVALID_ARGUMENT';
    if (structuredCode === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
    if (structuredCode === 'HTTP_STATUS') {
      if (structuredStatus === 401) return 'AUTH_REQUIRED';
      if (structuredStatus === 404) return 'NOT_FOUND';
      if (structuredStatus === 429) return 'RATE_LIMITED';
      return 'HTTP_ERROR';
    }
    if (['CHALLENGE', 'CONTENT_TYPE', 'INVALID_JSON', 'REDIRECT', 'SCHEMA_MISMATCH'].includes(structuredCode)) {
      return 'HTTP_ERROR';
    }

    current = current.cause;
  }

  return undefined;
}

function classifyError(error: unknown, message: string): CliErrorCode {
  if (isCommanderError(error)) {
    if (error.code === 'commander.unknownCommand') {
      return 'UNKNOWN_COMMAND';
    }
    return 'INVALID_ARGUMENT';
  }

  const structuredCode = structuredErrorCode(error);
  if (structuredCode) return structuredCode;

  const normalized = message.toLowerCase();
  if (
    normalized.includes('enotfound') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('aborterror')
  ) {
    return 'NETWORK_ERROR';
  }
  if (
    normalized.includes('http 401') ||
    normalized.includes('cookie') ||
    normalized.includes('login') ||
    message.includes('登录') ||
    message.includes('登录态')
  ) {
    return 'AUTH_REQUIRED';
  }
  if (
    normalized.includes('invalid') ||
    normalized.includes('must be') ||
    message.includes('必须') ||
    message.includes('不能为空') ||
    message.includes('未知') ||
    message.includes('不能超过') ||
    message.includes('不能同时')
  ) {
    return 'INVALID_ARGUMENT';
  }
  if (
    normalized.includes('http 404') ||
    normalized.includes('not found') ||
    message.includes('不存在') ||
    message.includes('未找到')
  ) {
    return 'NOT_FOUND';
  }
  if (normalized.includes('http ')) {
    return 'HTTP_ERROR';
  }
  return 'COMMAND_FAILED';
}

function isJsonOutputRequested(argv: readonly string[] = process.argv.slice(2)): boolean {
  return argv.includes('--json');
}

/** The next step depends on what failed; a command's own example only helps with argument mistakes. */
function suggestRecovery(error: unknown, code: CliErrorCode, ctx: CommandErrorContext): string | undefined {
  const sourceCode = error instanceof Error && 'code' in error ? error.code : undefined;
  if (sourceCode === 'CHALLENGE') {
    return '豆瓣要求安全验证，请暂停请求；可在浏览器中完成验证后再试，避免连续重试。';
  }
  if (code === 'RATE_LIMITED') {
    return '豆瓣暂时限制了请求，请稍后再试，避免连续重试；未登录时更容易被限制，可先运行 douban login';
  }
  if (code === 'AUTH_REQUIRED') return '运行 douban login，复用浏览器里已登录的豆瓣';
  if (code === 'NETWORK_ERROR') return '检查网络连接后重试';
  return ctx.suggestion;
}

function createErrorPayload(error: unknown, ctx: CommandErrorContext): CliErrorPayload {
  const rawMessage = isCommanderError(error) ? translateCommanderMessage(toMessage(error)) : toMessage(error);
  const code = classifyError(error, rawMessage);
  const target = ctx.target ? redactSensitiveArguments(ctx.target) : undefined;
  const recovery = suggestRecovery(error, code, ctx);
  const suggestion = recovery ? redactSensitiveArguments(recovery) : undefined;
  return {
    ok: false,
    error: {
      code,
      message: redactSensitiveArguments(rawMessage),
      command: ctx.command,
      ...(target ? { target } : {}),
      ...(suggestion ? { suggestion } : {})
    }
  };
}

function printCliError(error: unknown, ctx: CommandErrorContext): void {
  const payload = createErrorPayload(error, ctx);
  if (isJsonOutputRequested()) {
    console.error(JSON.stringify(payload));
    return;
  }

  const { code, message, target, suggestion } = payload.error;
  console.error(`❌ [${code}] ${message}${target ? ` (${target})` : ''}`);
  if (ctx.options && code === 'INVALID_ARGUMENT') {
    console.error(`   可选项：${redactSensitiveArguments(ctx.options)}`);
  }
  console.error(`   提示：${suggestion || '运行 douban --help 查看完整用法'}`);
}

/** Report degraded or partial results on stderr so stdout JSON stays parseable. */
export function printWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) console.error(`⚠️ ${warning}`);
}

export function withErrorHandler<T extends unknown[]>(
  ctx: CommandErrorContext | ErrorContextFactory<T>,
  fn: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      const resolved = typeof ctx === 'function' ? ctx(args, error) : ctx;
      printCliError(error, resolved);
      process.exitCode = 1;
    }
  };
}

export function handleProgramError(error: unknown): void {
  if (isCommanderError(error) && error.exitCode === 0) {
    return;
  }

  const path = typedCommandPath();
  let suggestion = `运行 douban ${path.join(' ')} --help 查看用法`;
  if (isCommanderError(error) && error.code === 'commander.unknownCommand') {
    const word = path[path.length - 1] ?? '';
    const parent = path.length > 1 ? 'douban book' : 'douban';
    suggestion = /[\u4e00-\u9fff]/.test(word)
      ? (path.length > 1 ? `查书请用：douban book info ${word}` : `查电影：douban movie ${word}；查书：douban book info ${word}`)
      : `运行 ${parent} --help 查看可用命令`;
  }
  printCliError(error, { command: 'douban', suggestion });
  process.exitCode = 1;
}
