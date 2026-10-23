// 手动组装便携版：不用 electron-builder（它下载 winCodeSign 会卡在网络上）。
// 用法：node scripts/pack.js
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT_NAME = '截图待办-win32-x64'
const RELEASE = path.join(ROOT, 'release')
const OUT = path.join(RELEASE, OUT_NAME)
const APP = path.join(OUT, 'resources', 'app')

function step(msg) {
  process.stdout.write(`• ${msg}\n`)
}

function robocopy(from, to) {
  const r = spawnSync('robocopy', [from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'], {
    stdio: 'ignore'
  })
  if (r.status === null || r.status >= 8) {
    throw new Error(`robocopy failed: ${from} -> ${to} (status ${r.status})`)
  }
}

step('清理 release')
if (fs.existsSync(RELEASE)) {
  spawnSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', RELEASE], { stdio: 'ignore' })
}
fs.mkdirSync(OUT, { recursive: true })

step('复制 Electron 运行时')
robocopy(path.join(ROOT, 'node_modules', 'electron', 'dist'), OUT)

// 精简语言包：Electron 自带 55 个语言，共 49MB；我们只需要简中/繁中/英文
const localesDir = path.join(OUT, 'locales')
if (fs.existsSync(localesDir)) {
  const keep = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])
  let removed = 0
  for (const f of fs.readdirSync(localesDir)) {
    if (!keep.has(f)) {
      fs.unlinkSync(path.join(localesDir, f))
      removed++
    }
  }
  step(`精简语言包：删除 ${removed} 个，保留 3 个`)
}

const defaultApp = path.join(OUT, 'resources', 'default_app.asar')
if (fs.existsSync(defaultApp)) fs.unlinkSync(defaultApp)

step('放入应用文件')
fs.mkdirSync(APP, { recursive: true })
for (const d of ['dist', 'dist-electron', 'build']) {
  robocopy(path.join(ROOT, d), path.join(APP, d))
}
fs.writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify(
    {
      name: 'screenshot-todo',
      productName: '截图待办',
      version: require(path.join(ROOT, 'package.json')).version,
      description: '截图即待办：监听剪贴板，微信截图自动入库',
      main: 'dist-electron/main.js'
    },
    null,
    2
  )
)

step('改名 + 写图标')
const exe = path.join(OUT, '截图待办.exe')
const oldExe = path.join(OUT, 'electron.exe')

// Windows 上刚复制完的 exe 常被杀毒/索引器短暂占用，rename 会 EPERM，需要重试
function renameRetry(src, dest) {
  for (let i = 0; i < 8; i++) {
    try {
      fs.renameSync(src, dest)
      return true
    } catch (e) {
      if (i === 7) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
  return false
}

if (fs.existsSync(oldExe)) {
  if (fs.existsSync(exe)) fs.unlinkSync(exe)
  renameRetry(oldExe, exe)
  step('已改名为 截图待办.exe')
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ver = pkg.version

const rcedit = path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
if (fs.existsSync(rcedit) && fs.existsSync(exe)) {
  const r = spawnSync(
    rcedit,
    [
      exe,
      '--set-icon', path.join(ROOT, 'build', 'icon.ico'),
      '--set-file-version', ver + '.0',
      '--set-product-version', ver,
      '--set-version-string', 'ProductName', '截图待办',
      '--set-version-string', 'FileDescription', '截图待办',
      '--set-version-string', 'CompanyName', 'WDY',
      '--set-version-string', 'OriginalFilename', '截图待办.exe',
      '--set-version-string', 'FileVersion', ver,
      '--set-version-string', 'ProductVersion', ver
    ],
    { stdio: 'inherit' }
  )
  step(r.status === 0 ? '图标与版本信息已写入' : `rcedit 退出码 ${r.status}`)
} else {
  step('跳过 rcedit（找不到 rcedit 或 exe）')
}

// 使用说明跟着包走
const doc = path.join(ROOT, 'docs', '使用说明.txt')
if (fs.existsSync(doc)) fs.copyFileSync(doc, path.join(OUT, '使用说明.txt'))

fs.mkdirSync(path.join(OUT, 'data'), { recursive: true })
step('完成 -> ' + OUT)
