## 云笺 1.1.6

**修一个显示问题：分区里的文件夹被画成了「磁盘」图标。**

### 原因

图标是问 Windows 要的（`SHGetFileInfo`）。这台机器上系统对**文件夹**返回的就是那张磁盘图，
`C://Windows` 和分区里的文件夹返回的是同一个图标——系统级的锅，不是我们传错了路径。

### 修法

文件夹不再问系统要图标，界面里自己画一个（内嵌 SVG）。文件仍然用系统图标（exe、xlsx 那些都正常）。

顺带少了一次 IPC 调用，分区打开更快一点。

### 怎么确认的

打开分区模式截图，`D://收纳-YUNJIAN//其他//翻译后` 左边已经显示成黄褐色文件夹。

### 国内下载地址

```
https://ghfast.top/https://github.com/rainlv00/screenshot-todo/releases/latest/download/YunJian-Setup.exe
```

备用：

```
https://gh-proxy.com/https://github.com/rainlv00/screenshot-todo/releases/latest/download/YunJian-Setup.exe
```

### 数据位置

- 待办、分区记录：`%APPDATA%\截图待办`
- 收纳的文件和文件夹：`D://收纳-YUNJIAN`

两处都不会随程序升级或卸载被删。
