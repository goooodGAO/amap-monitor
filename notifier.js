// 三种提醒渠道：邮箱(SMTP) / 企业微信群机器人 / Server酱
'use strict';
const https = require('https');
const nodemailer = require('nodemailer');

function formatAlerts(alerts) {
  return alerts.map(a => `【${a.group || '服务'}】${a.service}：已用 ${a.month_used}/${a.quota}（${a.pct}%）`).join('\n');
}

// 邮箱
async function sendEmail(cfg, subject, text) {
  const c = cfg.email;
  if (!c.user || !c.pass || !c.to) throw new Error('邮箱未配置完整(user/pass/to)');
  const transporter = nodemailer.createTransport({
    host: c.host, port: Number(c.port) || 465, secure: c.secure !== false,
    auth: { user: c.user, pass: c.pass },
  });
  await transporter.sendMail({
    from: `"高德用量监控" <${c.user}>`,
    to: c.to,
    subject, text,
  });
}

// 企业微信群机器人
function sendWecom(cfg, text) {
  return new Promise((resolve, reject) => {
    const url = cfg.wecom.webhook;
    if (!url) return reject(new Error('企业微信 webhook 未配置'));
    const body = JSON.stringify({ msgtype: 'text', text: { content: text } });
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.errcode === 0) resolve(); else reject(new Error('企业微信返回: ' + (j.errmsg || d)));
        } catch (e) { resolve(); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// Server酱
function sendServerChan(cfg, title, desp) {
  return new Promise((resolve, reject) => {
    const key = cfg.serverchan.sendkey;
    if (!key) return reject(new Error('Server酱 SendKey 未配置'));
    const body = new URLSearchParams({ title, desp });
    const req = https.request({
      hostname: 'sctapi.ftqq.com', path: `/${encodeURIComponent(key)}.send`, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body.toString()) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.code === 0) resolve(); else reject(new Error('Server酱返回: ' + (j.message || d)));
        } catch (e) { resolve(); }
      });
    });
    req.on('error', reject);
    req.write(body.toString()); req.end();
  });
}

// 触发所有已启用的渠道，返回 {ok:[], fail:[{channel,err}]}
async function notifyAll(cfg, alerts) {
  const title = '高德开放平台用量报警';
  const text = `以下服务当月用量已达阈值：\n${formatAlerts(alerts)}`;
  const ok = [], fail = [];
  const attempts = [];
  if (cfg.email && cfg.email.enabled) attempts.push(['email', sendEmail(cfg, title, text)]);
  if (cfg.wecom && cfg.wecom.enabled) attempts.push(['wecom', sendWecom(cfg, `[${title}]\n${text}`)]);
  if (cfg.serverchan && cfg.serverchan.enabled) attempts.push(['serverchan', sendServerChan(cfg, title, text)]);
  for (const [name, p] of attempts) {
    try { await p; ok.push(name); } catch (e) { fail.push({ channel: name, err: e.message }); }
  }
  return { ok, fail };
}

// 单渠道测试
async function testChannel(cfg, channel) {
  if (channel === 'email') { await sendEmail(cfg, '高德用量监控·测试邮件', '这是一封测试邮件，收到说明邮箱提醒配置成功。'); }
  else if (channel === 'wecom') { await sendWecom(cfg, '[高德用量监控] 测试消息，收到说明企业微信机器人配置成功。'); }
  else if (channel === 'serverchan') { await sendServerChan(cfg, '高德用量监控·测试', '测试消息，收到说明 Server酱 配置成功。'); }
  else throw new Error('未知渠道: ' + channel);
}

module.exports = { notifyAll, testChannel };
