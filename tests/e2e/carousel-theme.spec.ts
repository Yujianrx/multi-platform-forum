import { brandAssets } from '../../src/brand-assets';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginAs } from './auth';

test('三张图片轮播可切换、循环、键盘与手机手势操作', async ({ page }) => {
  await loginAs(page, 'chen.yu');
  const carousel = page.getByRole('region', { name: '首页推荐轮播' });
  const banners = (await (await page.request.get('/api/home')).json()).banners;
  expect(banners.length).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '查看推荐 ' + (i + 1), exact: true }).click();
    await expect(carousel).toHaveAttribute('data-slide', String(i + 1));
    await expect(carousel.locator('h1')).toHaveText(banners[i].title);
    await expect
      .poll(() =>
        carousel.locator('.carousel-image').evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(carousel.locator('.carousel-primary')).toHaveAttribute(
      'href',
      '/content/' + banners[i].content_id,
    );
  }
  await page.getByRole('button', { name: '下一张推荐', exact: true }).click();
  await expect(carousel).toHaveAttribute('data-slide', '1');
  await page.getByRole('button', { name: '上一张推荐', exact: true }).click();
  await expect(carousel).toHaveAttribute('data-slide', '3');
  await page.getByRole('button', { name: '上一张推荐', exact: true }).press('ArrowLeft');
  await expect(carousel).toHaveAttribute('data-slide', '2');
  await page.getByRole('button', { name: '查看推荐 1', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = (await carousel.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 280, y: box.y + box.height / 2 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: box.x + 110, y: box.y + box.height / 2 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(carousel).toHaveAttribute('data-slide', '2');
});

test('自动播放、悬停恢复、手动暂停与减少动态偏好相互独立', async ({ page }) => {
  await loginAs(page, 'chen.yu');
  await page.clock.install();
  await page.reload();
  const carousel = page.locator('.image-carousel');
  await expect(carousel).toHaveAttribute('data-slide', '1');
  await page.mouse.move(0, 0);
  await page.clock.fastForward(6700);
  await expect(carousel).toHaveAttribute('data-slide', '2');
  await carousel.hover();
  await page.clock.fastForward(14000);
  await expect(carousel).toHaveAttribute('data-slide', '2');
  await page.mouse.move(0, 0);
  await page.clock.fastForward(6700);
  await expect(carousel).toHaveAttribute('data-slide', '3');
  await page.getByRole('button', { name: '暂停轮播', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(14000);
  await expect(carousel).toHaveAttribute('data-slide', '3');
  await page.getByRole('button', { name: '播放轮播', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(6700);
  await expect(carousel).toHaveAttribute('data-slide', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Wait for the media-query event and React effect before advancing virtual time.
  await expect(page.locator('.pause-button')).toHaveCount(0);
  await page.clock.fastForward(14000);
  await expect(carousel).toHaveAttribute('data-slide', '1');
  await expect(page.locator('.pause-button')).toHaveCount(0);
  await page.getByRole('button', { name: '下一张推荐', exact: true }).click();
  await expect(carousel).toHaveAttribute('data-slide', '2');
});

test('轮播自定义图片、内容与外部链接、图片失败回退和空配置可用', async ({ page }) => {
  await loginAs(page, 'chen.yu');
  const response = await (await page.request.get('/api/home')).json();
  const original = response.banners[0];
  let banners: any[] = [
    { ...original, image_id: 'custom-cover', external_url: 'https://example.com/community' },
  ];
  let imageFails = false;
  await page.route('**/api/home', (route) => route.fulfill({ json: { ...response, banners } }));
  await page.route('**/api/files/custom-cover', (route) =>
    imageFails
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          contentType: 'image/png',
          body: readFileSync('public/brand/banners-clean/projects.png'),
        }),
  );
  await page.reload();
  const image = page.locator('.carousel-image');
  await expect(image).toHaveAttribute('src', '/api/files/custom-cover');
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.carousel-primary')).toHaveAttribute(
    'href',
    '/content/' + original.content_id,
  );
  await expect(page.locator('.carousel-controls')).toHaveCount(0);
  imageFails = true;
  banners = [{ ...banners[0], content_id: null, title: '自定义链接轮播' }];
  await page.reload();
  await expect(image).toHaveAttribute('src', brandAssets.banners.experience.src);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.carousel-primary')).toHaveAttribute(
    'href',
    'https://example.com/community',
  );
  await expect(page.locator('.carousel-primary')).toHaveAttribute('rel', 'noopener noreferrer');
  banners = [];
  await page.reload();
  await expect(page.locator('.carousel-dots button')).toHaveCount(3);
  await page.getByRole('button', { name: '查看推荐 2', exact: true }).click();
  await expect(page.locator('.carousel-primary')).toHaveAttribute('href', '/explore?type=project');
  await expect(image).toHaveAttribute('src', brandAssets.banners.projects.src);
});

test('红色品牌主题的首页、论坛、编辑器与资料页适配手机和平板', async ({ page }) => {
  await loginAs(page, 'zhou.ning');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of ['/', '/forum', '/forum/new', '/me?tab=settings']) {
    await page.goto(route);
    await expect(page.locator('.site-header')).toBeVisible();
    for (const width of [320, 390, 768, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      if (width > 760 || route === '/') {
        await expect(page.locator('.site-header .brand-wordmark')).toBeVisible();
        const logo = (await page.locator('.site-header .brand-wordmark').boundingBox())!;
        const title = (await page.locator('.site-header .brand-title').boundingBox())!;
        expect(logo.y + logo.height).toBeLessThanOrEqual(title.y + 1);
        expect(Math.abs(logo.x + logo.width / 2 - title.x - title.width / 2)).toBeLessThan(2);
      }
      if (route === '/' && width > 760) {
        const hero = (await page.locator('.image-carousel').boundingBox())!;
        const heading = (await page.locator('.image-carousel h1').boundingBox())!;
        const actions = (await page.locator('.image-carousel .hero-actions').boundingBox())!;
        expect(
          Math.abs((heading.y + actions.y + actions.height) / 2 - hero.y - hero.height / 2),
        ).toBeLessThan(2);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.getByRole('button', { name: '查看推荐 1', exact: true }).click();
  await page.locator('.carousel-image').evaluate((img: HTMLImageElement) => img.decode());
  // Decode every generated atlas through the browser, not merely a successful HTTP response.
  for (const atlas of [...Object.values(brandAssets.atlases), brandAssets.buttonAtlas]) {
    const loaded = await page.evaluate(async (atlas) => {
      const image = new Image();
      image.src = atlas;
      await image.decode();
      return image.naturalWidth >= 512;
    }, atlas);
    expect(loaded).toBe(true);
  }
  await expect(page.locator('.category-shortcuts [data-ai-icon]')).toHaveCount(10);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'outputs/红色社区-首页.png' });
  await page.getByRole('button', { name: '查看推荐 3', exact: true }).click();
  await page.locator('.carousel-image').evaluate((img: HTMLImageElement) => img.decode());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'outputs/红色社区-图片轮播.png' });
  await page.goto('/forum');
  await expect(page.locator('.topic-row').first()).toBeVisible();
  await page.screenshot({ path: 'outputs/红色社区-讨论区.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'outputs/红色社区-手机讨论区.png' });
  await page.goto('/');
  await page.getByRole('button', { name: '查看推荐 1', exact: true }).click();
  await page.locator('.carousel-image').evaluate((img: HTMLImageElement) => img.decode());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'outputs/红色社区-手机首页.png' });
  expect(errors).toEqual([]);
});
