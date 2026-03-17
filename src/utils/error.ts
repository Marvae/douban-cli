type CommandErrorContext = {
  command: string;
  target?: string;
  options?: string;
  suggestion?: string;
};

type ErrorContextFactory<T extends unknown[]> = (args: T, error: unknown) => CommandErrorContext;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyMessage(message: string): string {
  if (message.includes('ENOTFOUND') || message.includes('fetch failed') || message.includes('ECONNRESET')) {
    return '网络请求失败';
  }
  if (message.includes('HTTP 404') || message.includes('not found') || message.includes('Failed to fetch')) {
    return '资源不存在或已失效';
  }
  if (message.includes('must be numeric') || message.includes('Invalid')) {
    return '参数格式不正确';
  }
  return message;
}

function printFriendlyError(error: unknown, ctx: CommandErrorContext): void {
  const raw = toMessage(error);
  const main = classifyMessage(raw);
  const target = ctx.target ? `（${ctx.target}）` : '';
  const options = ctx.options || '可用命令：douban --help';

  console.error(`❌ ${main}${target}`);
  console.error(`   可选项：${options}`);
  if (ctx.suggestion) {
    console.error(`   提示：${ctx.suggestion}`);
  } else {
    console.error('   提示：运行 douban --help 查看完整用法');
  }
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
      printFriendlyError(error, resolved);
      process.exit(1);
    }
  };
}

export function handleProgramError(error: unknown): never {
  printFriendlyError(error, {
    command: 'douban',
    suggestion: '可运行 douban --help 查看可用命令'
  });
  process.exit(1);
}
