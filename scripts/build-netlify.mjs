import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
if (output !== path.resolve(root, 'dist')) throw new Error('Invalid Netlify output directory.');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'assets'), { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css']) {
  await fs.copyFile(path.join(root, file), path.join(output, file));
}
await fs.cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });

const apiBaseUrl = String(process.env.WORKERIN_API_BASE_URL || '').replace(/\/+$/, '');
if (apiBaseUrl && !/^https:\/\//i.test(apiBaseUrl)) {
  throw new Error('WORKERIN_API_BASE_URL precisa usar HTTPS.');
}
const config = `window.WORKERIN_CONFIG = Object.freeze({ apiBaseUrl: ${JSON.stringify(apiBaseUrl)} });\n`;
await fs.writeFile(path.join(output, 'workerin-config.js'), config, 'utf8');
console.log(`Netlify frontend built in dist/ (API ${apiBaseUrl ? 'configured' : 'not configured'}).`);
