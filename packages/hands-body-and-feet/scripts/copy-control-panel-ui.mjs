import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(packageRoot, 'src', 'control-panel', 'ui');
const targetDir = join(packageRoot, 'dist', 'ui');

if (!existsSync(sourceDir)) {
  throw new Error(`Control panel UI source not found: ${sourceDir}`);
}

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });
