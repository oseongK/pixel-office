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

async function holdUntil(page, key, pred, timeout = 15000) {
  await page.locator('canvas.po-world').click();
  await page.keyboard.down(key);
  try {
    await expect.poll(pred, { timeout, intervals: [50] }).toBe(true);
  } finally {
    await page.keyboard.up(key);
  }
}

test('출근 상태로 집에 다가가면 철퇴 → 회사에서 부활', async ({ page }) => {
  await page.goto('/index.html?demo=0');
  await holdUntil(page, 'ArrowLeft', async () => (await entity(page, 'me')).punished);
  const hitX = (await entity(page, 'me')).x;
  expect((await entity(page, 'me')).zone).not.toBe('home');

  // 연출 중 키 입력 무시
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowLeft');
  expect((await entity(page, 'me')).x).toBe(hitX);
  await page.keyboard.press('Enter');
  await expect(page.locator('.po-input')).toBeHidden();

  await expect.poll(async () => (await entity(page, 'me')).punished, { timeout: 5000 }).toBe(false);
  expect((await entity(page, 'me')).zone).toBe('office');
});

test('퇴근 상태면 집에 자유롭게 들어감', async ({ page }) => {
  await page.goto('/index.html?demo=0');
  await page.evaluate(() =>
    window.postMessage(
      { type: 'pixel-office:roster', users: [{ id: 'me', name: '나', status: 'offline' }] },
      '*',
    ),
  );
  await holdUntil(page, 'ArrowLeft', async () => (await entity(page, 'me')).zone === 'home');
  await page.waitForTimeout(300);
  expect((await entity(page, 'me')).punished).toBe(false);
});

test('철퇴 장면이 다른 사용자 화면에도 표시', async ({ browser }) => {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  try {
    const a = await ca.newPage();
    const b = await cb.newPage();
    await open(a, 'punish-a');
    await open(b, 'punish-b');
    await holdUntil(a, 'ArrowLeft', async () => (await entity(a, 'punish-a')).punished);
    await expect
      .poll(async () => (await entity(b, 'punish-a'))?.punished, { intervals: [50] })
      .toBe(true);
    await expect
      .poll(async () => (await entity(b, 'punish-a')).punished, { timeout: 6000 })
      .toBe(false);
    const ax = (await entity(a, 'punish-a')).x / (await state(a)).width;
    const bx = (await entity(b, 'punish-a')).x / (await state(b)).width;
    expect((await entity(b, 'punish-a')).zone).toBe('office');
    expect(Math.abs(ax - bx)).toBeLessThan(0.02);
  } finally {
    await ca.close();
    await cb.close();
  }
});

test('출근 직후 집에서 회사 쪽(→)으로 걸으면 철퇴 없음', async ({ page }) => {
  await page.goto('/index.html?demo=0');
  const roster = (status) =>
    page.evaluate(
      (st) =>
        window.postMessage(
          { type: 'pixel-office:roster', users: [{ id: 'me', name: '나', status: st }] },
          '*',
        ),
      status,
    );
  await roster('offline');
  await expect.poll(async () => (await entity(page, 'me')).zone, { timeout: 15000 }).toBe('home');
  await roster('online');
  await page.locator('canvas.po-world').click();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowRight');
  expect((await entity(page, 'me')).punished).toBe(false);
});

test('첫 로드 시 출근 상태인 내 캐릭터는 회사 구역 안에서 시작', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 400 });
  for (let i = 0; i < 8; i++) {
    await page.goto('/index.html?demo=0');
    const me = await entity(page, 'me');
    expect(me.zone, `시도 ${i + 1}: x=${me.x}`).toBe('office');
  }
});
