// 配置与历史数据持久化
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function userDataDir() {
  return app.getPath('userData');
}
function configPath() {
  return path.join(userDataDir(), 'config.json');
}
function historyPath() {
  return path.join(userDataDir(), 'history.json');
}

const DEFAULT_CONFIG = {
  threshold: 80,            // 当月用量占配额百分比，>= 即报警
  intervalMin: 60,          // 检测间隔(分钟)
  email: { enabled: false, host: 'smtp.qq.com', port: 465, secure: true, user: '', pass: '', to: '' },
  wecom: { enabled: false, webhook: '' },       // 企业微信群机器人 webhook
  serverchan: { enabled: false, sendkey: '' },  // Server酱 SendKey
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const cfg = JSON.parse(raw);
    return Object.assign({}, DEFAULT_CONFIG, cfg, {
      email: Object.assign({}, DEFAULT_CONFIG.email, cfg.email || {}),
      wecom: Object.assign({}, DEFAULT_CONFIG.wecom, cfg.wecom || {}),
      serverchan: Object.assign({}, DEFAULT_CONFIG.serverchan, cfg.serverchan || {}),
    });
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyPath(), 'utf-8'));
  } catch (e) {
    return [];
  }
}

function appendHistory(entry) {
  const h = loadHistory();
  h.push(entry);
  if (h.length > 5000) h.splice(0, h.length - 5000); // 最多留 5000 条
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(historyPath(), JSON.stringify(h), 'utf-8');
}

module.exports = { loadConfig, saveConfig, loadHistory, appendHistory, userDataDir };
