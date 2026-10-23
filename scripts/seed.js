/* eslint-disable */
// 测试数据脚本：把 D:/tmp/fake 里的假截图导入应用数据目录
// 用法: electron scripts/seed.js
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DatabaseSync } = require('node:sqlite')

const DATA = process.env.WDY_DATA_DIR || 'D:/WDY/截图待办/data'
const SRC = 'D:/tmp/fake'
const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400

const PLAN = [
  { file: '0-wechat.png', title: '', days: 0, status: 'pending' },
  { file: '1-mail.png', title: '整理产品需求文档', days: 0, status: 'pending' },
  { file: '2-ticket.png', title: '修复登录页样式问题', days: 1, status: 'pending' },
  { file: '3-error.png', title: '', days: 3, status: 'pending', reopen: 1 },
  { file: '4-sheet.png', title: '预约牙医', days: 8, status: 'pending' },
  { file: '5-doc.png', title: '读完《人月神话》第三章', days: 6, status: 'done', doneDays: 2, reopen: 2 }
]

app.whenReady().then(() => {
  fs.rmSync(DATA, { recursive: true, force: true })
  fs.mkdirSync(path.join(DATA, 'images'), { recursive: true })
  fs.mkdirSync(path.join(DATA, 'thumbs'), { recursive: true })

  const db = new DatabaseSync(path.join(DATA, 'tasks.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', image_path TEXT NOT NULL,
      thumb_path TEXT NOT NULL, img_hash TEXT NOT NULL, due_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL DEFAULT 'clipboard',
      reopen_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, completed_at INTEGER
    );
    CREATE UNIQUE INDEX idx_hash ON tasks(img_hash);
    CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  for (const p of PLAN) {
    const src = path.join(SRC, p.file)
    const img = nativeImage.createFromPath(src)
    if (img.isEmpty()) {
      console.log('skip (empty):', p.file)
      continue
    }
    const id = crypto.randomUUID()
    const { width, height } = img.getSize()
    const main = width > 2560 ? img.resize({ width: 2560, height: Math.round((height * 2560) / width), quality: 'good' }) : img
    const thumb = img.resize({ width: 400, height: Math.round((height * 400) / width), quality: 'good' })
    fs.writeFileSync(path.join(DATA, 'images', `${id}.jpg`), main.toJPEG(85))
    fs.writeFileSync(path.join(DATA, 'thumbs', `${id}.jpg`), thumb.toJPEG(80))

    const hash = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex')
    const createdAt = NOW - p.days * DAY - 3600
    const completedAt = p.status === 'done' ? NOW - (p.doneDays || 1) * DAY : null
    const dueAt = p.file === '4-sheet.png' ? NOW + 2 * DAY : null

    db.prepare(
      `INSERT INTO tasks(id,title,image_path,thumb_path,img_hash,due_at,status,source,reopen_count,created_at,completed_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, p.title || '', `images/${id}.jpg`, `thumbs/${id}.jpg`, hash, dueAt, p.status, 'clipboard', p.reopen || 0, createdAt, completedAt)

    db.prepare('INSERT INTO task_events(task_id,action,at) VALUES(?,?,?)').run(id, 'create', createdAt)
    if (p.status === 'done') {
      db.prepare('INSERT INTO task_events(task_id,action,at) VALUES(?,?,?)').run(id, 'complete', completedAt)
    }
    console.log('seeded', p.file, p.status, p.days + 'd')
  }

  db.prepare("INSERT INTO settings(key,value) VALUES('daily_remind_at','08:30') ON CONFLICT(key) DO NOTHING").run()
  db.prepare("INSERT INTO settings(key,value) VALUES('daily_remind_enabled','1') ON CONFLICT(key) DO NOTHING").run()
  db.prepare("INSERT INTO settings(key,value) VALUES('clipboard_watch','1') ON CONFLICT(key) DO NOTHING").run()

  db.close()
  console.log('seed done ->', DATA)
  app.quit()
})
