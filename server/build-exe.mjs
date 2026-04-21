#!/usr/bin/env node
/**
 * 使用 esbuild + pkg 打包成单 EXE
 */

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = __dirname;
const PROJECT_ROOT = join(SERVER_DIR, '..');

console.log('=== moonPlayer EXE Build ===\n');

// 1. 使用 esbuild 打包成单文件 (CommonJS)
console.log('[1/3] Bundling with esbuild...');

await build({
  entryPoints: [join(SERVER_DIR, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: join(SERVER_DIR, 'dist/bundled.cjs'),
  format: 'cjs',
  banner: {
    js: '// Bundled by esbuild'
  },
  external: [
    // sql.js 需要 WASM 文件，不能打包进去
    'sql.js',
  ],
  minify: false,
});

console.log('  Bundled: dist/bundled.cjs');

// 2. 复制 sql.js 的 WASM 文件
console.log('\n[2/3] Copying sql.js WASM...');
const wasmSrc = join(SERVER_DIR, 'node_modules/sql.js/dist/sql-wasm.wasm');
const wasmDest = join(SERVER_DIR, 'dist/sql-wasm.wasm');
copyFileSync(wasmSrc, wasmDest);
console.log('  Copied: sql-wasm.wasm');

// 3. 修改 schema.ts 加载 WASM 的路径
// (需要从外部文件加载，而不是从 node_modules)

console.log('\n[3/3] Creating pkg config...');

// 创建临时的 package.json 用于 pkg
const pkgConfig = {
  name: 'moonplayer-server',
  version: '1.0.0',
  main: 'dist/bundled.cjs',
  bin: 'dist/bundled.cjs',
  pkg: {
    targets: ['node18-win-x64'],
    output: 'moonplayer-server',
    assets: [
      'dist/sql-wasm.wasm',
      '../web/dist/**/*'
    ]
  }
};

writeFileSync(join(SERVER_DIR, 'pkg-package.json'), JSON.stringify(pkgConfig, null, 2));
console.log('  Created: pkg-package.json');

console.log('\n=== Bundle Complete ===');
console.log('\nNext step: Run pkg to create EXE');
console.log('  cd server');
console.log('  npx pkg . --config pkg-package.json --targets node18-win-x64 --output ../windows/build-exe/moonplayer-server.exe --compress GZip');