# antigravity-hans

给 [Google Antigravity](https://antigravity.google) 桌面版做的**简体中文界面汉化**。

运行时注入，**不修改 Antigravity 的任何文件**。

---

## 效果

菜单、侧边栏、设置面板、权限询问弹窗、运行状态提示都会显示为中文：

```
File / View / Window          ->  文件 / 视图 / 窗口
New Conversation               ->  新建对话
Ask anything, @ to mention     ->  随便问，@ 提及，/ 唤起操作
Allow running GitHub miner?    ->  允许运行 GitHub miner？
Worked for 2m                  ->  工作 2m
Yes, and always allow          ->  是，并始终允许
```

内置 1600+ 条词条，另有正则规则处理带变量的动态文案。

---

## 为什么不能直接装语言包

网上流传的教程大多是「`Ctrl+Shift+X` 装中文语言包」或「`Configure Display Language`」。

**那套流程针对的是 Antigravity IDE**（基于 VS Code 的那个产品）。而 Antigravity **桌面版**（`Antigravity.exe`，也就是 hub 客户端）是独立的 Electron 应用，没有扩展市场、没有命令面板、没有 `locale.json`，`app.asar` 里也搜不到任何 i18n 机制。照那些教程走会白折腾。

本项目走的是另一条路。

---

## 原理

Antigravity 启动时会带 `--remote-debugging-port=0` 参数，实际端口写在：

```
%APPDATA%\Antigravity\DevToolsActivePort
```

本项目的工作流程：

1. 读取该端口
2. 通过 CDP（Chrome DevTools Protocol）连进渲染进程
3. 注入一段脚本：用 `TreeWalker` 遍历文本节点做替换，并挂 `MutationObserver` 在 React 重渲染后自动补刀
4. 页面重载后自动重新注入

**全程不碰 Antigravity 的安装目录。** 不想要了，杀掉守护进程、刷新窗口，界面立刻回到英文。

---

## 环境要求

| 项目 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 |
| Antigravity | 桌面版 2.13.x（其他版本理论可用，未逐一验证） |
| Node.js | **不需要手动装** —— 安装器检测不到会自动下载绿色版 |

---

## 安装

**下载本仓库，双击 `install.bat`，完事。**

安装器会自动完成四件事：

1. 找 Node.js —— 系统里没有就**自动下载一个绿色版**解压到 `runtime\`，不装进系统、不改 PATH、不留痕迹
2. 定位 `Antigravity.exe`（找不到就从现有快捷方式里反推）
3. 生成 `launcher.vbs`（无窗口启动器）
4. **备份**并改写桌面 / 开始菜单的 Antigravity 快捷方式，指向启动器

之后照常点快捷方式启动，窗口出现后几秒界面变中文。原始快捷方式备份在 `backup\`。

> 首次运行会联网下载约 30 MB 的 Node.js。如果公司网络拦截了 nodejs.org，会退回提示你手动安装。

---

## 使用

**启动**：照常点快捷方式。守护进程会自己等应用就绪再注入。

**临时关闭汉化**：任务管理器结束 `node.exe` 进程，然后 `Ctrl+R` 刷新 Antigravity 窗口。

**恢复汉化**：重新点一次快捷方式。

**查看日志**：`src\hans-daemon.log`

---

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

停止守护进程、从备份还原快捷方式、清理生成的文件。

因为从未修改 Antigravity 本体，卸载后它自动就是英文原版。直接删掉整个文件夹也可以。

---

## 自定义词典

词典是纯 JSON，格式就是英文对中文：

```json
{
  "New Conversation": "新建对话",
  "Settings": "设置"
}
```

改完 `src\hans-dict.json` 后重启守护进程即可 —— 它会检测到词典变化并自动重新注入，不用重启 Antigravity。

**带变量的文案**用正则，写在 `src\hans-daemon.js` 的 `RULES` 数组里：

```js
[/^Worked for (.+)$/, "工作 $1"],
[/^Allow running (.+)\?$/, "允许运行 $1？"]
```

**看到一个词没翻**：改动会被 `noteMissed` 记进 `src/hans-missed.json`（只在运行时生成，不进仓库），里面是页面上所有没命中的英文文本，照着往里补就行。注意那个文件也会记下你自己的对话内容，补完记得删。

---

## 已知限制

- **只覆盖界面文案**。你的对话标题、AI 回复、代码片段不会被翻译，这是故意的。
- **不翻译专有名词**。`GitHub`、`Gemini`、`MCP`、`yt-dlp` 这类保持原样。
- **Antigravity 更新后可能失效**。官方一旦改了界面结构，部分词条会失配，需要补词典。
- **仅 Windows**。原理上 macOS 也能跑（CDP 是通用的），但安装脚本只写了 Windows。
- 用 Electron 原生对话框弹出的窗口（比如退出确认）**无法汉化**，那些不在网页 DOM 里。

---

## 免责声明

本项目是社区作品，与 Google LLC 及 Antigravity 团队无任何关联，未获其授权或背书。

它通过调试协议在运行时修改页面的显示文本，**不修改、不重打包、不分发 Antigravity 的任何文件**。即便如此，请自行评估使用风险，并遵守 Antigravity 的服务条款。

词典由项目维护者从界面文案整理翻译，非官方译文。

---

## License

[MIT](LICENSE)
