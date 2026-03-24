import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(import.meta.dirname, '..');
const nestedMainDir = path.join(appDir, 'dist', 'main', 'apps', 'desktop', 'src', 'main');
const targetMainDir = path.join(appDir, 'dist', 'main');

if (!fs.existsSync(nestedMainDir)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(nestedMainDir)) {
  const sourcePath = path.join(nestedMainDir, entry);
  const targetPath = path.join(targetMainDir, entry);
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}
