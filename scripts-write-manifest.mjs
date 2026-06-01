import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });

const manifestText = readFileSync(resolve(root, 'public-manifest.json'), 'utf8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(manifestText);
writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

const assets = resolve(root, 'src/assets');
if (existsSync(assets)) {
  cpSync(assets, resolve(dist, 'assets'), { recursive: true, force: true });
}
