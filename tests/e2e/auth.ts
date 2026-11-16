import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const access = JSON.parse(readFileSync('work/e2e-credentials.json', 'utf8'));
const saved = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();
// Reuse real authenticated sessions across flows instead of exhausting the login rate limit.
export async function loginAs(page: Page, username = 'admin') {
  if (saved.has(username)) {
    await page.context().addCookies(saved.get(username)!);
    await page.goto('/');
  } else {
    await page.goto('/');
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(access.password);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByLabel('验证码', { exact: true }).fill('AB7K');
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
        ),
        page.getByRole('button', { name: '进入社区', exact: true }).click(),
      ]);
      if (response.status() !== 429 || attempt === 1) break;
      // Multiple real accounts share one loopback IP in the suite. Honor the
      // server's retry window; never loosen the application's login limiter.
      const delay =
        Math.min(60, Math.max(1, Number(response.headers()['retry-after']) || 1)) * 1000 + 250;
      test.setTimeout(test.info().timeout + delay + 5000);
      await page.waitForTimeout(delay);
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/auth/captcha') && r.status() === 200),
        page.getByRole('button', { name: '更换验证码', exact: true }).click(),
      ]);
    }
    await expect(page.locator('.site-header')).toBeVisible();
    saved.set(username, await page.context().cookies());
  }
  await expect(page.locator('.site-header')).toBeVisible();
}
