#!/usr/bin/env node
/**
 * IPC 链路对账：preload 发出的 channel 必须有 main 里的 handler，反之亦然。
 *
 * 起因：v1.0.4 清代码时误删了一整段 IPC 注册（preview:open、desk:icon、
 * desk:shape、app:checkUpdate…），因为这些接口缺失**不报错**，前端只是静默失败，
 * 拖了一个多月才被用户发现。发版前跑一下这个脚本，能立刻发现同类问题。
 *
 * 用法：node scripts/check-ipc.js
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

const preload = read('electron/preload.ts')
const main = read('electron/main.ts')

const collect = (src, re) => {
  const out = new Set()
  let m
  while ((m = re.exec(src)) !== null) out.add(m[1])
  return out
}

// \s* 是必须的：很多地方写成 ipcMain.handle(\n  'channel',  —— 换行了
const sent = collect(preload, /ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)
const handled = collect(main, /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)

const missing = [...sent].filter((c) => !handled.has(c)).sort()
const unused = [...handled].filter((c) => !sent.has(c)).sort()

console.log(`preload 发出: ${sent.size} 个 channel`)
console.log(`main 注册:   ${handled.size} 个 channel`)
console.log('')

if (missing.length) {
  console.log('✗ 前端在调但主进程没接（会静默失败）：')
  missing.forEach((c) => console.log('   ', c))
} else {
  console.log('✓ 所有前端调用的 channel 都有对应 handler')
}

if (unused.length) {
  console.log('')
  console.log('· 主进程注册但没人调（死代码）：')
  unused.forEach((c) => console.log('   ', c))
}

process.exit(missing.length ? 1 : 0)
