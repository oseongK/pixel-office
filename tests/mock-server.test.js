import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import {
  createMockServer,
  parseClientMessage,
  sanitizeText,
  MAX_CHAT_LEN,
} from '../dev/mock-server.js';

test('sanitizeText: 제어문자 제거, trim, 길이 제한', () => {
  assert.equal(sanitizeText('  안녕\u0000\u202e  '), '안녕');
  assert.equal(sanitizeText('   '), null);
  assert.equal(sanitizeText(123), null);
  assert.equal([...sanitizeText('가'.repeat(100))].length, MAX_CHAT_LEN);
});

test('parseClientMessage: 잘못된 입력 거부', () => {
  assert.equal(parseClientMessage('not json'), null);
  assert.equal(parseClientMessage('null'), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'nope' })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'hello', id: '../etc' })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'move', x: 'a' })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'chat', text: '' })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: 'char', characterId: '<b>' })), null);
});

test('parseClientMessage: 정상 입력 정규화', () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'move', x: 5, facing: 0 })), {
    type: 'move',
    x: 1,
    facing: 1,
  });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'move', x: 0.123456, facing: -1 })), {
    type: 'move',
    x: 0.1235,
    facing: -1,
  });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'chat', text: ' hi ' })), {
    type: 'chat',
    text: 'hi',
  });
});

let server;
let port;
before(async () => {
  server = createMockServer();
  await new Promise((r) => server.http.listen(0, r));
  port = server.http.address().port;
});
after(() => {
  for (const c of server.wss.clients) c.terminate();
  server.wss.close();
  server.http.close();
});

function client() {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (pred) => {
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise((r) => waiters.push(r));
    }
  };
  return new Promise((r) => ws.on('open', () => r({ ws, next })));
}

test('chat 브로드캐스트 + 서버가 발신자 id 부여 + 빈도 제한', async () => {
  const a = await client();
  const b = await client();
  a.ws.send(JSON.stringify({ type: 'hello', id: 'kim' }));
  b.ws.send(JSON.stringify({ type: 'hello', id: 'lee' }));
  await b.next((m) => m.type === 'snapshot' && m.users.some((u) => u.id === 'lee'));
  a.ws.send(JSON.stringify({ type: 'chat', text: '안녕', id: 'spoof' }));
  a.ws.send(JSON.stringify({ type: 'chat', text: '도배' }));
  const m = await b.next((x) => x.type === 'chat');
  assert.equal(m.id, 'kim');
  assert.equal(m.text, '안녕');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(
    await Promise.race([
      b.next((x) => x.type === 'chat'),
      new Promise((r) => setTimeout(() => r(null), 50)),
    ]),
    null,
  );
  a.ws.close();
  b.ws.close();
});

test('/admin/status: 상태 변경 브로드캐스트, 잘못된 값 거부', async () => {
  const a = await client();
  const bad = await fetch(`http://localhost:${port}/admin/status?id=kim&status=hacked`);
  assert.equal(bad.status, 400);
  const ok = await fetch(`http://localhost:${port}/admin/status?id=park&status=online`);
  assert.equal(ok.status, 200);
  const m = await a.next((x) => x.type === 'status');
  assert.deepEqual(m, { type: 'status', id: 'park', status: 'online' });
  a.ws.close();
});

test('정적 서빙은 index.html 만', async () => {
  assert.equal((await fetch(`http://localhost:${port}/index.html`)).status, 200);
  assert.equal((await fetch(`http://localhost:${port}/package.json`)).status, 404);
});

test('1KB 초과 프레임에도 서버가 죽지 않음', async () => {
  const a = await client();
  const closed = new Promise((r) => a.ws.on('close', r));
  a.ws.send('x'.repeat(5000));
  await closed;
  const b = await client();
  b.ws.send(JSON.stringify({ type: 'hello', id: 'alive' }));
  await b.next((m) => m.type === 'snapshot');
  b.ws.close();
});

test('접속 종료 시 leave 브로드캐스트, 동적 사용자 제거', async () => {
  const a = await client();
  const b = await client();
  a.ws.send(JSON.stringify({ type: 'hello', id: 'temp1' }));
  b.ws.send(JSON.stringify({ type: 'hello', id: 'watcher' }));
  await b.next((m) => m.type === 'snapshot' && m.users.some((u) => u.id === 'watcher'));
  a.ws.close();
  assert.deepEqual(await b.next((m) => m.type === 'leave'), { type: 'leave', id: 'temp1' });
  assert.equal(server.users.has('temp1'), false);
  assert.equal(server.users.has('kim'), true);
  b.ws.close();
});

test('hello 는 연결당 1회만 처리', async () => {
  const a = await client();
  a.ws.send(JSON.stringify({ type: 'hello', id: 'once1' }));
  a.ws.send(JSON.stringify({ type: 'hello', id: 'once2' }));
  await a.next((m) => m.type === 'snapshot');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.users.has('once2'), false);
  a.ws.close();
});
