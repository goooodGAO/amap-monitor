'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const locales = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(locales)) return;
  for (const name of fs.readdirSync(locales)) {
    if (!['zh-CN.pak', 'en-US.pak'].includes(name)) {
      fs.rmSync(path.join(locales, name), { force: true });
    }
  }
};
