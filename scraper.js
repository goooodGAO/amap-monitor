// 高德控制台用量页的表格结构解析（纯逻辑，不依赖 electron，可单独测试）
'use strict';

// 把带 rowspan/colspan 的表格拍平成逻辑网格
// 注意: 必须是自执行 IIFE —— Electron 的 executeJavaScript 不会自动调用函数表达式(Playwright 才会)
const GRID_JS = `
(() => {
  const table = document.querySelector('table');
  if (!table) return { noTable: true, body: document.body.innerText.slice(0, 3000) };
  const grid = {};
  const rows = Array.from(table.rows);
  rows.forEach((tr, r) => {
    let c = 0;
    Array.from(tr.cells).forEach(td => {
      while (grid[r + ',' + c] !== undefined) c++;
      const rs = td.rowSpan || 1, cs = td.colSpan || 1;
      for (let i = 0; i < rs; i++)
        for (let j = 0; j < cs; j++)
          grid[(r + i) + ',' + (c + j)] = td.innerText.trim();
      c += cs;
    });
  });
  return rows.map((_, r) => {
    const row = [];
    for (let c = 0; c < 12; c++) {
      const v = grid[r + ',' + c];
      if (v === undefined) break;
      row.push(v);
    }
    return row;
  });
})()
`;

function toInt(s) {
  const digits = String(s == null ? '' : s).replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

// 从 grid rows 解析出结构化用量列表
// 实际表头: [服务(组), 服务范围(服务名), 月配额(次/月), 当月调用量(次), 当日调用量(次), ...]
function parseRows(rows) {
  if (!rows || rows.noTable || !Array.isArray(rows)) return [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].join(' ');
    if (joined.indexOf('月配额') !== -1 && joined.indexOf('服务') !== -1) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  const header = rows[headerIdx];
  const col = {};
  for (let i = 0; i < header.length; i++) {
    const name = header[i];
    if (name === '服务') col.group = i;
    else if (name.indexOf('服务范围') !== -1) col.service = i;
    else if (name.indexOf('月配额') !== -1) col.quota = i;
    else if (name.indexOf('当月调用量') !== -1) col.month = i;
    else if (name.indexOf('当日调用量') !== -1) col.day = i;
  }
  if (col.service === undefined || col.quota === undefined) return [];
  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 3) continue;
    const svc = (col.service < r.length ? r[col.service] : '') || '';
    if (!svc || svc === '服务' || svc === '服务范围') continue;
    const group = (col.group !== undefined && col.group < r.length ? r[col.group] : '') || '';
    const quota = col.quota < r.length ? toInt(r[col.quota]) : 0;
    const month = col.month !== undefined && col.month < r.length ? toInt(r[col.month]) : 0;
    const day = col.day !== undefined && col.day < r.length ? toInt(r[col.day]) : 0;
    items.push({
      group, service: svc, quota, month_used: month, day_used: day,
      pct: quota ? Math.round((month * 10000 / quota)) / 100 : null
    });
  }
  return items;
}

// 判断页面是否处于未登录状态
function isLoginPage(bodyText) {
  const t = String(bodyText || '');
  return t.indexOf('扫码登录') !== -1 || t.indexOf('请登录') !== -1 || t.indexOf('立即登录') !== -1;
}

module.exports = { GRID_JS, parseRows, isLoginPage, toInt };
