import path from 'node:path';
import { chmodSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { resolveCliStoragePaths } from './paths.js';
import { ensurePrivateDirectory, migratePrivateFile, secureAtomicWriteFile } from './secure-file.js';

export interface CliConfig {
  /** Default user for `me` and `book me`. */
  user?: string;
}

function parseConfig(content: string): CliConfig {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置文件必须是 JSON 对象');
  }

  const maybeUser = (parsed as Record<string, unknown>).user;
  if (maybeUser !== undefined && typeof maybeUser !== 'string') {
    throw new Error('配置项 user 必须是字符串');
  }
  if (typeof maybeUser === 'string') {
    const user = maybeUser.trim();
    return user ? { user } : {};
  }

  return {};
}

export function readConfig(): CliConfig {
  const { configPath, legacyConfigPath } = resolveCliStoragePaths();
  let selectedPath = configPath;
  let migrationFailed = false;

  try {
    migratePrivateFile(legacyConfigPath, configPath, (contents) => {
      parseConfig(contents);
    });
  } catch (error) {
    migrationFailed = true;
    selectedPath = legacyConfigPath;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[config] 迁移配置失败，继续使用旧配置: ${message}`);
  }

  try {
    const stat = lstatSync(selectedPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('配置文件不是普通文件');
    }
    if ((stat.mode & 0o077) !== 0) chmodSync(selectedPath, 0o600);
    const config = parseConfig(readFileSync(selectedPath, 'utf8'));

    if (!migrationFailed && selectedPath !== legacyConfigPath) {
      try {
        unlinkSync(legacyConfigPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[config] 清理旧配置失败: ${message}`);
        }
      }
    }
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取配置失败: ${message}`, { cause: error });
  }
}

export function writeConfig(config: CliConfig): void {
  const { configPath } = resolveCliStoragePaths();
  ensurePrivateDirectory(path.dirname(configPath));
  secureAtomicWriteFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
