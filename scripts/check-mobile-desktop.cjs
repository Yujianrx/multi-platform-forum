// Run against the isolated browser fixture before and after frontend changes.
// Never point this script at production: it uses local fixture credentials only.
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const phase = process.argv[2] || 'candidate';
  if (!['baseline', 'candidate'].includes(phase)) throw Error('Expected baseline or candidate');
  const directory = path.resolve('work/mobile-regression', phase);
  await fs.mkdir(directory, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    const access = JSON.parse(await fs.readFile('work/e2e-credentials.json', 'utf8'));
    await page.goto('http://127.0.0.1:3100');
    await page.getByLabel('账号', { exact: true }).fill('admin');
    await page.getByLabel('密码', { exact: true }).fill(access.password);
    await page.getByLabel('验证码', { exact: true }).fill('AB7K');
    await page.getByRole('button', { name: '进入社区', exact: true }).click();
    await page.locator('.site-header').waitFor();
    const results = [];
    for (const [name, url, width] of [
      ['home', '/', 1440],
      ['forum', '/forum', 1440],
      ['profile', '/me', 1440],
      ['editor', '/editor', 1440],
      ['messages', '/notifications', 1440],
      ['boundary', '/', 761],
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('http://127.0.0.1:3100' + url);
      await page.waitForLoadState('networkidle');
      await page
        .locator('.skeleton-grid')
        .waitFor({ state: 'hidden' })
        .catch(() => {});
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
      });
      await page.screenshot({
        path: path.join(directory, name + '.png'),
        fullPage: true,
        animations: 'disabled',
      });
      if (phase === 'candidate') {
        const old = await sharp(path.resolve('work/mobile-regression/baseline', name + '.png'))
          .raw()
          .toBuffer({ resolveWithObject: true });
        const now = await sharp(path.join(directory, name + '.png'))
          .raw()
          .toBuffer({ resolveWithObject: true });
        let changed = 0;
        if (old.data.length !== now.data.length) changed = -1;
        else
          for (let i = 0; i < old.data.length; i += old.info.channels)
            if (
              !old.data
                .subarray(i, i + old.info.channels)
                .equals(now.data.subarray(i, i + old.info.channels))
            )
              changed++;
        results.push({
          page: name,
          width,
          changedPixels: changed,
          changedRatio: changed / (old.info.width * old.info.height),
          sameDimensions: old.info.width === now.info.width && old.info.height === now.info.height,
        });
      }
    }
    if (phase === 'candidate') {
      await fs.writeFile(path.join(directory, 'comparison.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(results, null, 2));
      // Edge may rasterize scaled atlas icons with a few different edge pixels.
      // Keep the raw count in the report; allow at most 0.02%, never size changes.
      if (results.some((r) => !r.sameDimensions || r.changedPixels < 0 || r.changedRatio > 0.0002))
        process.exitCode = 1;
    } else console.log('Six desktop baseline screenshots saved.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
