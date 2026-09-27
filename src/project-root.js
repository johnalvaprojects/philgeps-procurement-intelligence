import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function useProjectRoot() {
  process.chdir(projectRoot);
  const envFile = path.join(projectRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
