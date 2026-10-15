// 主进程：窗口管理、登录、定时抓取、提醒调度
'use strict';
const { app, BrowserWindow, ipcMain, session, Tray, Menu } = require('electron');

// 兼容无 GPU / 远程桌面 / 安全软件注入等环境：彻底关闭 GPU 与沙箱，纯软件渲染
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const path = require('path');
const { GRID_JS, parseRows, isLoginPage } = require('./scraper');
const { loadConfig, saveConfig, loadHistory, appendHistory, userDataDir } = require('./storage');
const { notifyAll, testChannel } = require('./notifier');

const AMAP_URL = 'https://console.amap.com/dev/flow/manage/a2dcd21e2eae9a7dbdbf566f7485aea8';
const PARTITION = 'persist:amap';
const LBS_GROUP = '基础LBS服务'; // 只监控这个服务组

let mainWin = null;
let tray = null;
let isQuitting = false;
let timer = null;
let initialCheckTimer = null;
let config = loadConfig();
let state = {
  items: [], lbsTotal: null, lastCheck: null, lastAlerts: [], checking: false, loggedIn: null,
  lbsAlerted: false, notify: { ok: [], fail: [] },
};

function broadcast() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('state-updated', state);
  }
}

// 用持久 partition 开隐藏窗口抓取用量
function fetchUsage() {
  return new Promise((resolve, reject) => {
    let win;
    try {
      win = new BrowserWindow({
        show: false, width: 1440, height: 900,
        webPreferences: { partition: PARTITION, offscreen: false },
      });
    } catch (e) { return reject(e); }
    const timeout = setTimeout(() => { try { win.destroy(); } catch (e) {} reject(new Error('抓取超时')); }, 100000);
    let done = false;
    const finish = (err, data) => {
      if (done) return; done = true;
      clearTimeout(timeout);
      try { win.destroy(); } catch (e) {}
      if (err) reject(err); else resolve(data);
    };
    win.webContents.on('did-fail-load', (e, code, desc) => {
      if (code === -3) return; // aborted
      finish(new Error('加载失败: ' + desc));
    });
    win.webContents.once('did-finish-load', async () => {
      // 轮询等待表格渲染
      // 关键: EGG_SESS(会话)过期时会先跳登录页，高德 passport 会用长期 cookie 静默换发新会话再跳回，
      // 换新过程需数秒到十几秒——所以遇到登录页不能立即判失败，继续等，让自动续期走完。
      for (let i = 0; i < 40; i++) {
        if (done) return;
        try {
          const rows = await win.webContents.executeJavaScript(GRID_JS, true);
          if (rows && !rows.noTable) {
            finish(null, { rows, bodyText: '' });
            return;
          }
        } catch (e) { /* 页面导航/就绪中，继续等 */ }
        await new Promise(r => setTimeout(r, 2000));
      }
      // 40 次(约 80 秒)仍未出表格，此时才真正判断是否登录页(长期 cookie 也失效才需要重扫码)
      try {
        const body = await win.webContents.executeJavaScript('document.body.innerText.slice(0,3000)', true);
        if (isLoginPage(body)) { finish(new Error('NEED_LOGIN')); return; }
      } catch (e) {}
      finish(new Error('PARSE_EMPTY'));
    });
    win.loadURL(AMAP_URL).catch(e => finish(e));
  });
}

async function runCheck() {
  if (state.checking) return;
  state.checking = true;
  broadcast();
  try {
    const { rows } = await fetchUsage();
    const items = parseRows(rows);
    state.lastError = null;
    state.items = items;
    state.loggedIn = items.length > 0;
    state.lastCheck = new Date().toISOString();

    // 基础LBS服务组：当月调用量加总 / 组共享月配额
    // 注意: 150000/月是整组共享的配额池，控制台每行重复显示同一值，取最大值即共享配额，禁止加总
    const lbsItems = items.filter(it => it.group === LBS_GROUP);
    const lbsMonth = lbsItems.reduce((s, it) => s + (it.month_used || 0), 0);
    const lbsQuota = lbsItems.reduce((m, it) => Math.max(m, it.quota || 0), 0);
    state.lbsTotal = {
      month_used: lbsMonth, quota: lbsQuota,
      pct: lbsQuota ? Math.round(lbsMonth * 10000 / lbsQuota) / 100 : null,
      services: lbsItems.length,
    };

    // 报警：合计当月调用量占共享月配额 >= 阈值（边沿触发，只发一次）
    const triggered = state.lbsTotal.pct != null && state.lbsTotal.pct >= config.threshold;
    const alertItem = triggered
      ? [{ group: LBS_GROUP, service: '当月调用量合计', quota: lbsQuota, month_used: lbsMonth, pct: state.lbsTotal.pct }]
      : [];
    state.lastAlerts = alertItem;
    let alerts = [];
    if (triggered && !state.lbsAlerted) {
      alerts = alertItem;
      state.lbsAlerted = true;
    } else if (!triggered) {
      state.lbsAlerted = false; // 回落到阈值下后重新武装
    }
    state.notify = { ok: [], fail: [] };
    if (alerts.length) {
      state.notify = await notifyAll(config, alerts);
    }
    appendHistory({ time: state.lastCheck, threshold: config.threshold, items, lbsTotal: state.lbsTotal, alerts: triggered ? 1 : 0 });
  } catch (e) {
    if (e.message === 'NEED_LOGIN') state.loggedIn = false;
    state.lastCheck = new Date().toISOString();
    state.lastError = e.message;
  } finally {
    state.checking = false;
    broadcast();
  }
}

function setupTimer() {
  if (timer) clearInterval(timer);
  if (initialCheckTimer) clearTimeout(initialCheckTimer);
  const min = Math.min(1440, Math.max(1, Number(config.intervalMin) || 60));
  timer = setInterval(() => { runCheck(); }, min * 60 * 1000);
  // 启动后延迟 3 秒做一次首检
  initialCheckTimer = setTimeout(() => { initialCheckTimer = null; runCheck(); }, 3000);
}

function openLoginWindow() {
  const win = new BrowserWindow({
    width: 1000, height: 760, title: '登录高德账号',
    webPreferences: { partition: PARTITION },
  });
  // 第三方登录(支付宝/微信)可能开新窗，统一在同窗口跳转
  win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
  win.loadURL(AMAP_URL);
  // 轮询检测：用量表一出现(登录成功)就自动关窗并触发一次检测
  let done = false;
  const poll = setInterval(async () => {
    if (win.isDestroyed() || done) { clearInterval(poll); return; }
    try {
      const rows = await win.webContents.executeJavaScript(GRID_JS, true);
      if (rows && !rows.noTable && Array.isArray(rows) && parseRows(rows).length > 0) {
        done = true;
        clearInterval(poll);
        try { await session.fromPartition(PARTITION).flushCookiesData(); } catch (e) {} // 立即刷盘防丢登录态
        win.destroy();
      }
    } catch (e) { /* 页面尚未就绪 */ }
  }, 2000);
  win.on('closed', () => { clearInterval(poll); runCheck(); });
}

function showMain() {
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); }
  else createMainWindow();
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch (e) { return; }
  tray.setToolTip('高德用量监控');
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => showMain() },
    { label: '立即检测', click: () => runCheck() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMain());
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1080, height: 760, minWidth: 900, minHeight: 620,
    title: '高德用量监控',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 点 X 不退出: 隐藏到系统托盘, 后台继续定时检测
  mainWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

// IPC
ipcMain.handle('get-state', () => ({ state, config, history: loadHistory().slice(-100) }));
ipcMain.handle('check-now', () => { runCheck(); return true; });
ipcMain.handle('open-login', () => { openLoginWindow(); return true; });
ipcMain.handle('logout', async () => {
  // 退出登录/切换账号：清空高德登录态，再弹登录窗
  try {
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData();
  } catch (e) { /* 忽略清除失败 */ }
  state.loggedIn = false;
  state.items = [];
  state.lbsTotal = null;
  state.lastAlerts = [];
  state.lbsAlerted = false;
  broadcast();
  openLoginWindow();
  return true;
});
ipcMain.handle('save-config', (e, cfg) => {
  const incoming = cfg && typeof cfg === 'object' ? cfg : {};
  config = Object.assign(loadConfig(), incoming);
  config.threshold = Math.min(100, Math.max(1, Number(config.threshold) || 80));
  config.intervalMin = Math.min(1440, Math.max(1, Number(config.intervalMin) || 60));
  saveConfig(config);
  setupTimer();
  return config;
});
ipcMain.handle('test-notify', async (e, channel) => {
  try { await testChannel(config, channel); return { ok: true }; }
  catch (err) { return { ok: false, err: err.message }; }
});
ipcMain.handle('get-history', () => loadHistory());

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  setupTimer();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

// 托盘常驻: 关掉所有窗口也不退出, 后台继续定时检测
app.on('window-all-closed', () => {});
