export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>使用说明</span>
          <button className="tb-btn" onClick={onClose} title="关闭">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="modal-body help-body">
          <h3>一句话</h3>
          <p>
            微信截个图，自动进待办。做完打个勾，它自己走到「已完成」。拿错了再勾回来。
            <br />
            数据全在本机，不联网、不要账号。
          </p>

          <h3>1. 收录一张待办</h3>
          <p>
            微信按 <b>Alt+A</b> 截图 → 点工具栏的 <b>√</b>（复制到剪贴板）。
            0.9 秒内卡片自动出现，右下角弹「已收入待办」，5 秒内可以撤销。
          </p>
          <p className="warn">
            注意：必须点 <b>√</b>，不能点「另存为」。只有进了剪贴板的图才会被收录。
          </p>

          <h3>2. 做完了 / 做错了</h3>
          <ul>
            <li>点卡片左边的方框 → 掉进「已完成」</li>
            <li>在「已完成」里再点一次 → 回到待办，并记一次「拿回过」</li>
            <li>悬停卡片，点右侧垃圾桶 → 6 秒内可撤销</li>
          </ul>

          <h3>3. 看完一遍：拖了多久</h3>
          <p>
            每张卡片标着「今天 / 拖了 3 天 / 拖了 2 周」，颜色随天数变：
            <b>3 天转橙、7 天转红</b>。积压区把放得最久的排在最上面。
          </p>

          <h3>4. 截图不是待办怎么办</h3>
          <p>做教程、发图给别人时，别一张张删，直接暂停收录：</p>
          <ul>
            <li>托盘图标右键 → 暂停收录 → 15 分钟 / 1 小时 / 到明早</li>
            <li>或按快捷键（默认 Ctrl+Alt+P）切暂停</li>
            <li>暂停时顶部有橙色条，点一下立刻恢复</li>
          </ul>

          <h3>5. 外观</h3>
          <p>标题栏两个按钮：</p>
          <ul>
            <li>
              <b>半圆图标</b>：不透明度 10%–100%、底色六选一（白/灰/黑/蓝/绿/黄）。
              调低能看到桌面，文字不会跟着变淡。
            </li>
            <li>
              <b>图片图标</b>：选一张图做背景，可以裁剪；铺法选「完整（留底色）」或「铺满（裁边）」；
              背景太花就调高遮罩。
            </li>
          </ul>

          <h3>6. 钉在桌面上不挡事</h3>
          <ul>
            <li><b>始终置顶</b>：默认关闭。关着就是普通窗口，别的软件会盖住它，不会挡你干活。</li>
            <li><b>锁定面板</b>：锁住后拖不动、关不掉，防止误触。解锁在托盘右键。</li>
            <li>窗口可以随意拉伸，最小 320×360。</li>
          </ul>

          <h3>7. 列表 / 宫格</h3>
          <p>标签行右侧的小方块按钮切换。宫格适合「图很多，先扫一眼哪个眼熟」，列表适合精确管理。</p>

          <h3>8. 每天早上的提醒</h3>
          <p>
            默认每天 <b>08:30</b> 弹一条系统通知：<code>7 条待处理，最早一条压了 4 天</code>。
            没有待办时不打扰。时间可在设置里改。
          </p>
          <p className="warn">
            如果收不到通知：检查开始菜单里是否有「截图待办」这个快捷方式，删掉通知就弹不出来了。
          </p>

          <h3>9. 数据在哪 / 怎么备份</h3>
          <p>
            全部在 exe 同目录的 <code>data\</code> 里：<code>tasks.db</code> 是记录，
            <code>images\</code> 和 <code>thumbs\</code> 是图片。
            <b>把整个 data 目录拷走就是完整备份</b>，换机器放回去就能接着用。
          </p>

          <h3>10. 快捷键</h3>
          <ul>
            <li><b>Ctrl+Alt+V</b>：把剪贴板里最新的图收录进来</li>
            <li><b>Ctrl+Alt+P</b>：暂停 / 恢复收录</li>
          </ul>
          <p>两个都可以在设置里录制成自己的组合（必须是 2~3 个键，且含 Ctrl/Alt/Shift/Win）。</p>

          <h3>11. 退出</h3>
          <p>
            点窗口的 × 只是收进托盘，程序还在后台跑（这样提醒和自动收录才有效）。
            真正退出：托盘图标右键 → 退出截图待办。
          </p>

          <div className="help-foot">截图待办 v1.0.1 · 本地运行 · 不收集任何数据</div>
        </div>
      </div>
    </div>
  )
}
