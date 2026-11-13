/**
 * 一键跑测试：
 *   node scripts/test.js        （或 npm test）
 *
 * 三套：
 *   tests/db.test.ts     数据层（node 直接跑，不依赖 Electron）
 *   tests/ui.test.ts     前端纯函数（node 直接跑）
 *   tests/files.test.ts  文件搬移（需要 Electron 运行时）
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

// 这两个环境变量会让 Electron 退化成纯 Node，跑起来全是假崩溃
const env = { ...process.env }
delete env.NODE_OPTIONS
delete env.ELECTRON_RUN_AS_NODE

function bundle(entry) {
  const out = entry.replace(/\.ts$/, '.cjs')
  execFileSync(ESBUILD, [entry, '--bundle', '--platform=node', '--format=cjs', '--target=node22', '--external:electron', `--outfile=${out}`, '--log-level=warning'], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32'
  })
  return out
}

const suites = [
  { name: '数据层', entry: 'tests/db.test.ts', runtime: 'node' },
  { name: '前端函数', entry: 'tests/ui.test.ts', runtime: 'node' },
  { name: '文件搬移', entry: 'tests/files.test.ts', runtime: 'electron' }
]

let failed = 0
for (const s of suites) {
  process.stdout.write(`\n=== ${s.name} ===\n`)
  try {
    const cjs = bundle(path.join(ROOT, s.entry))
    const bin = s.runtime === 'electron' ? ELECTRON : process.execPath
    const args = s.runtime === 'electron' ? [cjs, '--disable-gpu'] : [cjs]
    const out = execFileSync(bin, args, { cwd: ROOT, env, encoding: 'utf8' })
    const line = out.split('\n').filter((l) => l.includes('用例')).pop() || ''
    console.log(line.trim())
    if (out.includes('失败明细')) {
      console.log(out.slice(out.indexOf('失败明细')).trim())
      failed++
    }
  } catch (e) {
    failed++
    const out = `${e.stdout || ''}${e.stderr || ''}`
    console.log('运行失败')
    console.log(out.split('\n').filter((l) => l.trim()).slice(-12).join('\n'))
  }
}

// 清掉中间产物
for (const f of fs.readdirSync(path.join(ROOT, 'tests'))) {
  if (f.endsWith('.cjs')) fs.unlinkSync(path.join(ROOT, 'tests', f))
}

console.log(failed ? `\n✗ ${failed} 套失败` : '\n✓ 全部通过')
process.exit(failed ? 1 : 0)
