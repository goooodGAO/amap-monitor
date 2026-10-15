'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let config = {};
let history = [];

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtNum(n) { return Number(n || 0).toLocaleString('zh-CN'); }

function setStatus() {
  const b = $('#statusBadge');
  if (window.state.checking) { b.className = 'badge busy'; b.textContent = '检测中…'; }
  else if (window.state.loggedIn === false) { b.className = 'badge warn'; b.textContent = '未登录'; }
  else if (window.state.lastAlerts && window.state.lastAlerts.length) { b.className = 'badge warn'; b.textContent = `${window.state.lastAlerts.length} 项超标`; }
  else if (window.state.loggedIn) { b.className = 'badge ok'; b.textContent = '正常'; }
  else { b.className = 'badge'; b.textContent = '待检测'; }
}

function renderDash() {
  const st = window.state;
  const errorBanner = $('#errorBanner');
  errorBanner.style.display = st.lastError ? 'block' : 'none';
  errorBanner.textContent = st.lastError ? `最近一次检测未完成：${st.lastError}` : '';
  $('#cLast').textContent = fmtTime(st.lastCheck);
  $('#cCount').textContent = st.items ? st.items.length : '—';
  const alerts = st.lastAlerts || [];
  $('#cAlert').textContent = alerts.length ? alerts.length + ' 项' : '0';
  $('#cAlert').className = 'v' + (alerts.length ? ' warn' : '');
  const lt = st.lbsTotal;
  $('#cTop').textContent = lt && lt.pct != null ? `${fmtNum(lt.month_used)} / ${fmtNum(lt.quota)}（${lt.pct}%）` : '—';
  $('#cTop').className = 'v' + (lt && lt.pct != null && lt.pct >= config.threshold ? ' warn' : '');

  const tb = $('#tblBody');
  tb.innerHTML = '';
  const items = (st.items || []).filter(it => it.group === '基础LBS服务').sort((a, b) => (b.pct || 0) - (a.pct || 0));
  $('#tblEmpty').style.display = items.length ? 'none' : 'block';
  items.forEach(it => {
    const tr = document.createElement('tr');
    const warn = it.pct != null && it.pct >= config.threshold;
    const mid = it.pct != null && it.pct >= config.threshold * 0.7 && !warn;
    const barCls = warn ? 'warn' : (mid ? 'mid' : '');
    tr.innerHTML =
      `<td>${esc(it.service)}</td><td class="row-tag">${esc(it.group || '-')}</td>` +
      `<td>${it.quota ? fmtNum(it.quota) : '-'}</td><td>${fmtNum(it.month_used)}</td>` +
      `<td class="pct ${warn ? 'warn' : ''}">${it.pct != null ? it.pct + '%' : '-'}</td>` +
      `<td><div class="bar"><i class="${barCls}" style="width:${Math.min(100, it.pct || 0)}%"></i></div></td>`;
    tb.appendChild(tr);
  });
  renderTrend();
}

function renderTrend() {
  const box = $('#trendBox');
  if (history.length < 2) { box.innerHTML = '<div class="empty">积累几次检测后这里会画出趋势。</div>'; return; }
  const W = 900, H = 180, P = 30;
  const pts = history.slice(-30).map(h => {
    let v = 0;
    if (h.lbsTotal) v = h.lbsTotal.month_used;
    else (h.items || []).forEach(it => { if (it.group === '基础LBS服务') v += it.month_used || 0; });
    return { t: fmtTime(h.time), v };
  });
  const max = Math.max(1, ...pts.map(p => p.v));
  const step = (W - P * 2) / Math.max(1, pts.length - 1);
  const coords = pts.map((p, i) => [P + i * step, H - P - (p.v / max) * (H - P * 2)]);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block">`;
  for (let g = 0; g <= 3; g++) { const y = P + g * (H - P * 2) / 3; svg += `<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" stroke="#33334a"/>`; }
  svg += `<polyline fill="none" stroke="#5b7cfa" stroke-width="2" points="${coords.map(c => c[0] + ',' + c[1]).join(' ')}"/>`;
  coords.forEach((c, i) => {
    svg += `<circle cx="${c[0]}" cy="${c[1]}" r="3" fill="#5b7cfa"/>`;
    if (i === coords.length - 1) svg += `<text x="${c[0]}" y="${c[1] - 8}" font-size="11" fill="#e8e8ef" text-anchor="end">${fmtNum(pts[i].v)}</text>`;
  });
  svg += `<text x="${P}" y="${H - 8}" font-size="11" fill="#8b8ba3">${pts[0].t}</text>`;
  svg += `<text x="${W - P}" y="${H - 8}" font-size="11" fill="#8b8ba3" text-anchor="end">${pts[pts.length - 1].t}</text>`;
  svg += '</svg>';
  box.innerHTML = svg;
}

function fillSettings() {
  $('#cfgThreshold').value = config.threshold;
  $('#cfgInterval').value = String(config.intervalMin);
  $('#emailOn').checked = !!config.email.enabled;
  $('#emailHost').value = config.email.host || '';
  $('#emailPort').value = config.email.port || '';
  $('#emailUser').value = config.email.user || '';
  $('#emailPass').value = config.email.pass || '';
  $('#emailTo').value = config.email.to || '';
  $('#wecomOn').checked = !!config.wecom.enabled;
  $('#wecomHook').value = config.wecom.webhook || '';
  $('#scOn').checked = !!config.serverchan.enabled;
  $('#scKey').value = config.serverchan.sendkey || '';
  const lb = $('#loginBadge');
  if (window.state.loggedIn) { lb.textContent = '已登录'; lb.className = 'badge ok'; }
  else if (window.state.loggedIn === false) { lb.textContent = '未登录'; lb.className = 'badge warn'; }
  else { lb.textContent = '未知'; lb.className = 'badge'; }
}

function collectConfig() {
  return {
    threshold: Number($('#cfgThreshold').value) || 80,
    intervalMin: Number($('#cfgInterval').value) || 60,
    email: {
      enabled: $('#emailOn').checked,
      host: $('#emailHost').value.trim(), port: Number($('#emailPort').value) || 465, secure: true,
      user: $('#emailUser').value.trim(), pass: $('#emailPass').value.trim(), to: $('#emailTo').value.trim(),
    },
    wecom: { enabled: $('#wecomOn').checked, webhook: $('#wecomHook').value.trim() },
    serverchan: { enabled: $('#scOn').checked, sendkey: $('#scKey').value.trim() },
  };
}

function bindEvents() {
  $$('.tab button').forEach(b => b.addEventListener('click', () => {
    $$('.tab button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    $('#tab-dash').style.display = b.dataset.tab === 'dash' ? 'block' : 'none';
    $('#tab-settings').style.display = b.dataset.tab === 'settings' ? 'block' : 'none';
  }));
  $('#btnCheck').addEventListener('click', () => { $('#btnCheck').disabled = true; window.api.checkNow(); setTimeout(() => $('#btnCheck').disabled = false, 15000); });
  $('#btnLogin').addEventListener('click', () => window.api.openLogin());
  $('#btnLogout').addEventListener('click', () => window.api.logout());
  $('#btnSave').addEventListener('click', async () => {
    config = await window.api.saveConfig(collectConfig());
    $('#saveHint').textContent = '已保存';
    setTimeout(() => $('#saveHint').textContent = '', 2000);
  });
  async function test(ch, el) {
    const r = await window.api.testNotify(ch);
    const node = $(el);
    node.textContent = r.ok ? '发送成功' : '失败: ' + r.err;
    node.className = 'test-result ' + (r.ok ? 'ok' : 'no');
  }
  $('#testEmail').addEventListener('click', () => test('email', '#testEmailR'));
  $('#testWecom').addEventListener('click', () => test('wecom', '#testWecomR'));
  $('#testSc').addEventListener('click', () => test('serverchan', '#testScR'));
}

async function init() {
  const data = await window.api.getState();
  window.state = data.state;
  config = data.config;
  history = data.history || [];
  setStatus();
  renderDash();
  fillSettings();
  bindEvents();
  window.api.onState((s) => { window.state = s; setStatus(); renderDash(); fillSettings(); });
}

init();
