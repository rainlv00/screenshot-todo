"""把截图用的临时数据恢复到固定状态（每次截图前调用，避免上一张的改动影响下一张）。"""
import sqlite3

DB = 'D:/tmp/shots-ud/data/tasks.db'
FIXED = {
    'view': 'list',
    'hotkey_capture': 'Ctrl+Alt+V',
    'hotkey_pause': 'Ctrl+Alt+J',
    'panel_alpha': '0.94',
    'bg_color': 'white',
    'text_tone': 'auto',
    'font_size': 'normal',
    'locked': '0',
    'always_on_top': '0',
    'clipboard_watch': '1',
    'paused_until': '0',
}

db = sqlite3.connect(DB)
sql = 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
for k, v in FIXED.items():
    db.execute(sql, (k, v))
db.commit()
db.close()
