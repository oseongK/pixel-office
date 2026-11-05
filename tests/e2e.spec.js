import { test, expect } from '@playwright/test';

const WS = 'ws://localhost:8799';
const state = (page) => page.evaluate(() => window.__pixelOffice.getState());
const entity = async (page, id) => (await state(page)).entities.find((e) => e.id === id);

async function open(page, me) {
  await page.goto(`/index.html?me=${me}&ws=${WS}`);
  await expect.poll(async () => (await state(page)).connected).toBe(true);
  await expect.poll(async () => (await state(page)).entities.length).toBeGreaterThan(3);
}

async function chat(page, text) {
  await page.locator('canvas.po-world').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.po-input')).toBeVisible();
  await page.locator('.po-input').fill(text);
  await page.keyboard.press('Enter');
}

test('데모 모드: 캐릭터 30종 이상, 직원 렌더', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto('/index.html');
  const s = await state(page);
  expect(s.characters.length).toBeGreaterThanOrEqual(30);
  expect(new Set(s.characters).size).toBe(s.characters.length);
  expect(s.entities.length).toBe(7);
  await expect(page.locator('.po-count')).toContainText('Online');
  expect(errors).toEqual([]);
});

test('화살표 이동은 캔버스 포커스 시에만', async ({ page }) => {
  await page.goto('/index.html?demo=0');
  const x0 = (await entity(page, 'me')).x;
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  expect((await entity(page, 'me')).x).toBe(x0);

  await page.locator('canvas.po-world').click();
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowLeft');
  expect((await entity(page, 'me')).x).toBeLessThan(x0 - 10);
});

test('Enter 말풍선이 다른 사용자 화면에도 실시간 표시', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await open(a, 'kim');
  await open(b, 'lee');
  await chat(a, '  커피 한잔 하실 분?  ');
  expect((await entity(a, 'kim')).bubble).toBe('커피 한잔 하실 분?');
  await expect.poll(async () => (await entity(b, 'kim'))?.bubble).toBe('커피 한잔 하실 분?');
  await expect(a.locator('.po-input')).toBeHidden();
  expect((await state(a)).focused).toBe(true);
});

test('말풍선 XSS 차단 및 40자 제한', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await open(a, 'choi');
  await open(b, 'kang');
  const evil = '<img src=x onerror="window.__xss=1">';
  await chat(a, evil);
  await expect.poll(async () => (await entity(b, 'choi'))?.bubble).toBe(evil);
  expect(await b.evaluate(() => window.__xss)).toBeUndefined();
  expect(await b.locator('img').count()).toBe(0);

  await a.waitForTimeout(600);
  await chat(a, 'ㅋ'.repeat(60));
  await expect.poll(async () => [...((await entity(b, 'choi'))?.bubble ?? '')].length).toBe(40);
});

test('근태 상태 변경 시 집 ↔ 회사로 이동 (서버)', async ({ page, request }) => {
  await request.get('/admin/status?id=jung&status=offline');
  await open(page, 'lee');
  await expect.poll(async () => (await entity(page, 'jung')).zone, { timeout: 15000 }).toBe('home');
  await request.get('/admin/status?id=jung&status=online');
  await expect.poll(async () => (await entity(page, 'jung')).status).toBe('online');
  await expect
    .poll(async () => (await entity(page, 'jung')).zone, { timeout: 15000 })
    .toBe('office');
});

test('대시보드 postMessage 로 로스터/상태 주입', async ({ page }) => {
  await page.goto('/index.html?me=u1&demo=0');
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'pixel-office:roster',
        users: [
          { id: 'u1', name: '나나', status: 'online' },
          { id: 'u2', name: '<b>둘</b>', status: 'offline', characterId: 'frog-pink' },
          { id: 'bad id!', name: 'x', status: 'online' },
        ],
      },
      '*',
    ),
  );
  await expect.poll(async () => (await state(page)).entities.length).toBe(2);
  const u2 = await entity(page, 'u2');
  expect(u2).toMatchObject({ name: '<b>둘</b>', status: 'offline', characterId: 'frog-pink' });
  await page.evaluate(() =>
    window.postMessage({ type: 'pixel-office:status', id: 'u2', status: 'online' }, '*'),
  );
  await expect.poll(async () => (await entity(page, 'u2')).zone, { timeout: 15000 }).toBe('office');
});

test('캐릭터 선택 변경 후 새로고침해도 유지', async ({ page }) => {
  await page.goto('/index.html?demo=0');
  const before = (await entity(page, 'me')).characterId;
  await page.locator('.po-next').click();
  await page.locator('.po-next').click();
  const picked = (await entity(page, 'me')).characterId;
  expect(picked).not.toBe(before);
  await expect(page.locator('.po-name')).toContainText('/');
  await page.reload();
  expect((await entity(page, 'me')).characterId).toBe(picked);
});

test('로스터 postMessage 가 WebSocket 전용 사용자를 지우지 않음', async ({ page }) => {
  await open(page, 'lee');
  await page.evaluate(() =>
    window.postMessage(
      { type: 'pixel-office:roster', users: [{ id: 'lee', name: '이', status: 'online' }] },
      '*',
    ),
  );
  await page.waitForTimeout(100);
  expect(await entity(page, 'kim')).toBeTruthy();
});

test('잘못된 parentOrigin/ws 파라미터는 무시', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto('/index.html?demo=0&ws=javascript:alert(1)&parentOrigin=evil');
  const s = await state(page);
  expect(s.connected).toBe(false);
  await page.evaluate(() =>
    window.postMessage(
      { type: 'pixel-office:roster', users: [{ id: 'z', status: 'online' }] },
      '*',
    ),
  );
  await expect.poll(async () => !!(await entity(page, 'z'))).toBe(true);
  expect(errors).toEqual([]);
});

test('창 크기 변경 시 회사에 있던 직원이 회사 구역 유지', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 400 });
  await page.goto('/index.html?me=u1&demo=0');
  await page.evaluate(() =>
    window.postMessage(
      { type: 'pixel-office:roster', users: [{ id: 'u3', name: 'u3', status: 'online' }] },
      '*',
    ),
  );
  await expect.poll(async () => (await entity(page, 'u3'))?.zone).toBe('office');
  await page.setViewportSize({ width: 1300, height: 400 });
  await expect.poll(async () => (await state(page)).width).toBeGreaterThan(420);
  await expect.poll(async () => (await entity(page, 'u3')).zone, { timeout: 10000 }).toBe('office');
});
