# 高德用量监控 · 源码说明

高德开放平台「基础LBS服务」用量监控桌面软件（Electron）。

盯的是**基础LBS服务组**的当月调用量占共享月配额的比例，达到阈值自动通过邮件 / 企业微信机器人 / Server酱 报警。

## 文件结构

```
amap-monitor-src/
├── main.js              主进程：窗口、登录、定时抓取、报警调度（托盘常驻）
├── preload.js           渲染进程安全桥（contextBridge 暴露 window.api）
├── scraper.js           高德用量表格解析（GRID_JS 注入脚本 + parseRows）
├── notifier.js          三种提醒渠道：邮箱 / 企业微信机器人 / Server酱
├── storage.js           配置与历史持久化（config.json / history.json）
├── renderer/
│   ├── index.html       界面（仪表盘 + 设置）
│   └── renderer.js      界面逻辑
├── icon.png / icon.ico  图标（托盘与窗口）
├── start.bat            开发模式一键启动（npm install + electron .）
├── build.bat            一键打包 exe（npm run dist）
└── package.json         依赖与 electron-builder 打包配置
```

## 运行

```bash
npm install        # 首次（国内建议已配好 .npmrc 镜像）
npm start          # 开发模式启动
```

或直接双击 `start.bat`。

## 打包成 exe

```bash
npm run dist       # 生成 NSIS 安装包 + 免安装 zip，输出到 release/
npm run pack       # 只生成免安装目录 release/win-unpacked/
```

或双击 `build.bat`。产物：
- `release/高德用量监控 Setup 1.0.0.exe`（安装版）
- `release/高德用量监控-1.0.0-win.zip`（免安装）

## 使用要点

1. **首次登录**：打开软件 → 设置 → 重新登录 → 弹出高德控制台页扫码登录。登录态用持久 partition（`persist:amap`）保存，之后自动续期，一般不用重扫。
2. **托盘常驻**：点窗口 X 不退出，缩到系统托盘后台继续定时检测；退出请走托盘右键菜单。
3. **报警逻辑**：基础LBS服务组「当月调用量合计 ÷ 组共享月配额 ≥ 阈值」触发，边沿触发（只在跨过阈值时发一次，回落后重新武装）。
4. **提醒渠道**：三种可同时启用，谁配好谁发。每个渠道都有「发送测试」按钮验证。

## 关键实现坑点（改代码前务必看）

| 位置 | 说明 |
|---|---|
| `main.js` `fetchUsage()` | EGG_SESS 会话过期时会先跳登录页，高德 passport 会用长期 cookie **静默换发新会话再跳回**，需数秒到十几秒。因此遇登录页不能立即判失败，要轮询等够（当前 40×2s）再判 NEED_LOGIN |
| `main.js` LBS 配额 | `150000/月` 是**整组共享**配额池，控制台每行重复显示同一值 → 取 `Math.max` 而非 `+=`，加总会翻 N 倍 |
| `scraper.js` `GRID_JS` | 必须是**自执行 IIFE**。Electron 的 `executeJavaScript` 不会自动调用函数表达式（Playwright 才会），写成函数会静默失效 |
| `scraper.js` | 表格有 rowspan/colspan，先拍平成逻辑网格再按表头名定位列，不要写死列序号 |
| `main.js` 启动参数 | 已强制关闭 GPU / 沙箱，兼容无显卡、远程桌面、安全软件注入环境（`disableHardwareAcceleration` 必须在 `app.whenReady` 前调用） |
| `openLoginWindow()` | 登录成功后 `flushCookiesData()` 立刻刷盘，否则可能丢登录态 |

## 依赖版本（已验证可打包）

- electron `33.4.11`
- electron-builder `^25.1.8`
- nodemailer `^6.9.16`
