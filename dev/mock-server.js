// 개발/테스트용 mock 서버. 실제 운영은 대시보드 백엔드가 PROTOCOL.md 스펙대로 구현한다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';

export const MAX_CHAT_LEN = 40;
export const CHAT_INTERVAL_MS = 500;
export const MAX_USERS = 200;
export const PUNISH_INTERVAL_MS = 3000;

const ID_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const CHAR_RE = /^[a-z0-9-]{1,32}$/;
const EFFECT_RE = /^[a-z-]{1,16}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

export function sanitizeText(text) {
  if (typeof text !== 'string') return null;
  const clean = [...text.replace(CONTROL_RE, '').trim()].slice(0, MAX_CHAT_LEN).join('');
  return clean.length ? clean : null;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

// 클라이언트 메시지 검증. 유효하면 정규화된 객체, 아니면 null.
export function parseClientMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.type) {
    case 'hello':
      return isValidId(msg.id) ? { type: 'hello', id: msg.id } : null;
    case 'move': {
      if (typeof msg.x !== 'number' || !Number.isFinite(msg.x)) return null;
      // x 는 화면 폭 대비 비율(0~1). 클라이언트마다 화면 폭이 달라서 정규화한다.
      const x = Math.round(Math.max(0, Math.min(1, msg.x)) * 10000) / 10000;
      return { type: 'move', x, facing: msg.facing === -1 ? -1 : 1 };
    }
    case 'chat': {
      const text = sanitizeText(msg.text);
      return text ? { type: 'chat', text } : null;
    }
    case 'punish': {
      // effect 는 형식만 검사한다. 모르는 효과는 클라이언트가 기본(mace)으로 재생한다.
      const out = { type: 'punish' };
      if (typeof msg.effect === 'string' && EFFECT_RE.test(msg.effect)) out.effect = msg.effect;
      if (typeof msg.to === 'number' && Number.isFinite(msg.to)) {
        out.to = Math.round(Math.max(0, Math.min(1, msg.to)) * 10000) / 10000;
      }
      return out;
    }
    case 'char':
      return typeof msg.characterId === 'string' && CHAR_RE.test(msg.characterId)
        ? { type: 'char', characterId: msg.characterId }
        : null;
    default:
      return null;
  }
}

const SEED = [
  { id: 'kim', name: '김하늘', status: 'online', characterId: 'worker-red' },
  { id: 'lee', name: '이바다', status: 'online', characterId: 'shroom-red' },
  { id: 'park', name: '박구름', status: 'offline', characterId: 'turtle-green' },
  { id: 'choi', name: '최별', status: 'online', characterId: 'cat-orange' },
  { id: 'jung', name: '정숲', status: 'offline', characterId: 'robot-silver' },
  { id: 'kang', name: '강산', status: 'online', characterId: 'penguin-blue' },
];

export function createMockServer() {
  const users = new Map(SEED.map((u) => [u.id, { ...u, x: null, facing: 1 }]));
  const seedIds = new Set(SEED.map((u) => u.id));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const http = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(body);
    }
    if (url.pathname === '/admin/status') {
      const id = url.searchParams.get('id');
      const status = url.searchParams.get('status');
      const user = users.get(id);
      if (!user || !['online', 'offline'].includes(status)) {
        res.writeHead(400);
        return res.end('bad request');
      }
      user.status = status;
      broadcast({ type: 'status', id, status });
      res.writeHead(200);
      return res.end('ok');
    }
    res.writeHead(404);
    res.end('not found');
  });

  const wss = new WebSocketServer({ server: http, maxPayload: 1024 });

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(data);
  }

  function snapshot() {
    return { type: 'snapshot', users: [...users.values()] };
  }

  wss.on('connection', (ws) => {
    let me = null;
    let lastChat = 0;
    let lastPunish = 0;
    // 크기 초과 프레임 등 프로토콜 오류 시 프로세스가 죽지 않도록
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      if (!me || [...wss.clients].some((c) => c !== ws && c.userId === me)) return;
      const user = users.get(me);
      if (user) user.x = null;
      if (!seedIds.has(me)) users.delete(me);
      broadcast({ type: 'leave', id: me });
    });
    ws.on('message', (raw) => {
      const msg = parseClientMessage(raw);
      if (!msg) return;
      // mock 이므로 hello.id 를 신뢰한다. 실서버는 세션으로 식별해야 함.
      if (msg.type === 'hello') {
        if (me) return;
        if (!users.has(msg.id) && users.size >= MAX_USERS) return ws.close(1013, 'full');
        me = msg.id;
        ws.userId = me;
        if (!users.has(me)) {
          users.set(me, {
            id: me,
            name: me,
            status: 'online',
            characterId: null,
            x: null,
            facing: 1,
          });
        }
        broadcast(snapshot());
        return;
      }
      if (!me) return;
      const user = users.get(me);
      if (msg.type === 'move') {
        user.x = msg.x;
        user.facing = msg.facing;
        broadcast({ type: 'move', id: me, x: msg.x, facing: msg.facing });
      } else if (msg.type === 'chat') {
        const now = Date.now();
        if (now - lastChat < CHAT_INTERVAL_MS) return;
        lastChat = now;
        broadcast({ type: 'chat', id: me, text: msg.text, ts: now });
      } else if (msg.type === 'punish') {
        const now = Date.now();
        if (user.status !== 'online' || now - lastPunish < PUNISH_INTERVAL_MS) return;
        lastPunish = now;
        broadcast({ ...msg, id: me });
      } else if (msg.type === 'char') {
        user.characterId = msg.characterId;
        broadcast({ type: 'char', id: me, characterId: msg.characterId });
      }
    });
  });

  return { http, wss, users };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  createMockServer().http.listen(port, () => {
    console.log(
      `mock server: http://localhost:${port}/index.html?me=kim&ws=ws://localhost:${port}`,
    );
  });
}
