/**
 * 文件搬移测试：拖入时分区归属、文件夹跨盘搬移、还原。
 * 需要 Electron 环境（files.ts 用了 app.getPath），用 electron 跑。
 */
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDb, getDb } from '../electron/db'
import {
  setInstallDir,
  ensurePresetCategories,
  addCategory,
  addFilesByPaths,
  listArchived,
  restoreOne,
  storageRoot
} from '../electron/files'

let pass = 0
const fails: string[] = []

function ok(cond: boolean, name: string, extra = ''): void {
  if (cond) pass++
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

function eq<T>(a: T, b: T, name: string): void {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}

app.whenReady().then(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yj-files-'))
  const dataDir = path.join(root, 'data')
  const storageBase = path.join(root, 'storage')
  const workDir = path.join(root, 'work')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(storageBase, { recursive: true })
  fs.mkdirSync(workDir, { recursive: true })

  setInstallDir(storageBase)
  initDb(dataDir)
  ensurePresetCategories()

  const cat = addCategory('测试分区', ['txt'])
  ok(!!cat.id, '新建分区成功')

  // ---- 1. 单个文件指定分区 ----
  const file1 = path.join(workDir, '销货单.txt')
  fs.writeFileSync(file1, 'hello')
  const r1 = addFilesByPaths([file1], cat.id)
  eq(r1.failed, [], '单文件：没有失败项')
  eq(r1.moved.length, 1, '单文件：搬移 1 个')
  eq(r1.moved[0]?.category, '测试分区', '单文件：落到了指定分区（不是自动猜）')
  ok(!fs.existsSync(file1), '单文件：源文件已移走')

  const db = getDb()
  const row1 = db.prepare('SELECT category_id, path FROM files WHERE name = ?').get('销货单.txt') as any
  eq(row1?.category_id, cat.id, '单文件：库里分类是目标分区')
  ok(String(row1?.path ?? '').includes('测试分区'), '单文件：落盘目录带分区名')
  ok(fs.existsSync(String(row1?.path)), '单文件：目标文件确实存在')

  // ---- 2. 文件夹（带子目录）指定分区 ----
  const folder = path.join(workDir, '汇总资料')
  fs.mkdirSync(path.join(folder, '子目录'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'a.txt'), 'A')
  fs.writeFileSync(path.join(folder, '子目录', 'b.txt'), 'B')
  const r2 = addFilesByPaths([folder], cat.id)
  eq(r2.failed, [], '文件夹：没有失败项')
  eq(r2.moved[0]?.category, '测试分区', '文件夹：落到了指定分区')
  ok(!fs.existsSync(folder), '文件夹：源目录已清除')

  const row2 = db.prepare('SELECT category_id, path FROM files WHERE name = ?').get('汇总资料') as any
  eq(row2?.category_id, cat.id, '文件夹：库里分类正确')
  ok(fs.existsSync(path.join(String(row2?.path), 'a.txt')), '文件夹：顶层文件搬过来了')
  ok(fs.existsSync(path.join(String(row2?.path), '子目录', 'b.txt')), '文件夹：嵌套文件搬过来了')
  eq(fs.readFileSync(path.join(String(row2?.path), '子目录', 'b.txt'), 'utf8'), 'B', '文件夹：嵌套文件内容完整')

  // ---- 3. 不传分区时仍按扩展名自动归类 ----
  const file3 = path.join(workDir, '随便.txt')
  fs.writeFileSync(file3, 'x')
  const r3 = addFilesByPaths([file3])
  eq(r3.moved.length, 1, '不传分区：也能收录')

  // ---- 4. 还原回原位置 ----
  const id1 = (db.prepare('SELECT id FROM files WHERE name = ?').get('销货单.txt') as any).id
  eq(restoreOne(id1), true, '还原：返回成功')
  ok(fs.existsSync(file1), '还原：文件回到原位置')
  ok(!fs.existsSync(String(row1?.path)), '还原：收纳里已清掉')
  const st1 = db.prepare('SELECT state FROM files WHERE id = ?').get(id1) as any
  eq(st1?.state, 'restored', '还原：状态标记为 restored')

  // ---- 5. 分区列表里能看到 ----
  const archived = listArchived()
  ok(archived.some((f) => f.path === String(row2?.path)), '已归档列表包含文件夹')
  const folderItem = archived.find((f) => f.path === String(row2?.path))
  eq(folderItem?.isDir, true, '归档列表里 folder 被识别为目录')

  // ---- 输出 ----
  const total = pass + fails.length
  console.log(`\n用例 ${total} 条：通过 ${pass}，失败 ${fails.length}`)
  if (fails.length) {
    console.log('\n失败明细:')
    fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  }
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
  app.exit(fails.length ? 1 : 0)
})
