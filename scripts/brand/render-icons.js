// Renders scripts/brand/icons/*.svg to PNG at the sizes the apps need.
const { chromium } = require('playwright');
const fs = require('fs');
const D = __dirname + '/icons/';
const jobs = [['web-apple-icon', 180], ['m-icon', 1024], ['m-fg', 512], ['m-bg', 512], ['m-mono', 512], ['m-splash', 1024], ['m-favicon', 48], ['web-icon', 64]];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [n, s] of jobs) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    const svg = fs.readFileSync(D + n + '.svg', 'utf8').replace('<svg ', '<svg width="' + s + '" height="' + s + '" ');
    await p.setContent('<html><body style="margin:0;background:transparent">' + svg + '</body></html>');
    await p.screenshot({ path: D + n + '.png', omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
    await p.close();
  }
  await b.close();
})();
