# Pixel Office — AI 이식/유지보수 가이드

> 이 문서는 **AI 코딩 어시스턴트**가 Pixel Office를 다른 프로젝트에 이식하거나 수정할 때 읽는 문서다.
> 사람용 개요는 `README.md`, 서버 메시지 스펙은 `PROTOCOL.md` 를 본다.
> 작업 전에 이 문서 → `PROTOCOL.md` → `index.html` 순으로 읽을 것.

## 1. 한 줄 요약

근태 대시보드 상단 배너용 **단일 HTML 파일**(`index.html`, 외부 의존성 0, 빌드 없음) 도트 게임.
직원 캐릭터가 `online` → 회사, `offline` → 집에 서 있고, 내 캐릭터는 화살표로 이동·Enter로 말풍선.
출근 중 집 쪽으로 걸어가면 철퇴 연출 후 회사에서 부활.

## 2. 파일 역할 (이식 대상 구분)

| 파일                             | 이식 필요          | 역할                                                                    |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `index.html`                     | **필수**           | 본체. CSS + JS 인라인. 이 파일 하나만 정적 호스팅하면 동작              |
| `PROTOCOL.md`                    | **필수(백엔드용)** | postMessage / WebSocket JSON 스펙, 서버 보안 요구사항                   |
| `dev/mock-server.js`             | 선택(개발용)       | 테스트용 WebSocket + 정적 서버. **운영 사용 금지** (`hello.id` 를 신뢰) |
| `tests/*.test.js`                | 선택               | mock 서버 단위 테스트 (node:test)                                       |
| `tests/e2e.spec.js`              | 선택               | Playwright E2E. `window.__pixelOffice.getState()` 로 상태 검증          |
| `package.json`, lint/format 설정 | 선택               | devDependencies 만 존재. 런타임 의존성 없음                             |

## 3. 이식 방법 (권장: iframe)

### 3.1 왜 iframe 인가

`index.html` 은 독립 문서로 작성되어 있어 그대로 페이지에 붙이면 충돌한다:

- `html, body { margin:0; background:#1d2b53 }` 전역 스타일
- `window.__pixelOffice` 전역, `window` 의 `message` 리스너
- `document.getElementById('pixel-office')` 고정 id
- localStorage 키 `pixelOffice.characterId`

iframe 이면 위 항목이 모두 격리된다. **직접 인라인 삽입은 하지 말 것** (꼭 필요하면 4.5절 참고).

### 3.2 배치

1. `index.html` 을 호스트 프로젝트의 정적 경로에 복사 (예: `public/pixel-office/index.html`)
2. iframe 으로 삽입, URL 파라미터 전달

| 파라미터       | 값                                      | 비고                                                     |
| -------------- | --------------------------------------- | -------------------------------------------------------- |
| `me`           | 로그인 사용자 id `[A-Za-z0-9_.-]{1,32}` | 형식 불일치 시 `'me'` 로 대체됨                          |
| `ws`           | `wss://...` WebSocket URL               | 없으면 실시간 공유 없음. `ws:`/`wss:` 외 프로토콜은 무시 |
| `parentOrigin` | 대시보드 origin (`https://host[:port]`) | 없거나 잘못되면 iframe 자신의 origin 만 허용             |
| `demo=0`       | `ws` 없이 쓸 때 **반드시** 지정         | 생략하면 가짜 직원 6명 + 랜덤 출퇴근 데모가 돈다         |

### 3.3 iframe 높이

캔버스 배율은 컨테이너 폭으로 자동 결정된다 (`resize()`): `scale = min(3, floor(폭/384))`, 폭 384 미만이면 축소.
실측 높이(테두리+하단 바 포함):

| 컨테이너 폭 | 배율 | 높이(px) |
| ----------- | ---- | -------- |
| 384 ~ 767   | 1    | 158      |
| 768 ~ 1151  | 2    | 270      |
| 1152 이상   | 3    | 382      |

공식: `112 × scale + 46`. 폭이 약 390px 미만이면 하단 바 텍스트가 줄바꿈되어 더 높아진다.
부모에서 폭에 따라 높이를 계산해 지정하거나, 고정 `height: 382px` 로 둔다 (남는 영역은 배경색).

### 3.4 데이터 주입 (postMessage)

iframe `load` 이후 전송. 대상 origin 은 iframe 의 origin.

```js
iframe.contentWindow.postMessage(
  {
    type: 'pixel-office:roster',
    users: [
      { id: 'kim', name: '김하늘', status: 'online', characterId: 'worker-red' },
      { id: 'lee', name: '이바다', status: 'offline' },
    ],
  },
  'https://<iframe origin>',
);
```

- **roster 는 전체 목록**: roster 로 들어왔다가 다음 roster 에 없는 사람은 제거된다 (WebSocket 으로만 들어온 사람, 본인은 제거 안 됨)
- 같은 roster 를 반복 전송해도 안전: 상태가 바뀐 사람만 출퇴근 애니메이션이 재생된다. 근태가 바뀔 때마다 roster 전체를 다시 보내는 방식이 가장 단순하다
- 단건 변경: `{ type: 'pixel-office:status', id, status }`
- **본인(`me`)도 roster 에 포함**시켜야 이름/상태가 반영된다 (없으면 이름=id, 상태=online)
- `characterId` 생략 시 id 해시로 자동 배정. 본인은 사용자가 고른 값(localStorage)이 우선

### 3.5 프레임워크별 예시

**React**

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';

export function PixelOfficeBanner({ me, users, wsUrl, src = '/pixel-office/index.html' }) {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const url = useMemo(() => {
    const u = new URL(src, window.location.href);
    u.searchParams.set('me', me);
    if (wsUrl) u.searchParams.set('ws', wsUrl);
    else u.searchParams.set('demo', '0');
    u.searchParams.set('parentOrigin', window.location.origin);
    return u.toString();
  }, [src, me, wsUrl]);

  useEffect(() => {
    if (!loaded) return;
    ref.current?.contentWindow?.postMessage(
      { type: 'pixel-office:roster', users },
      new URL(url).origin,
    );
  }, [loaded, users, url]);

  return (
    <iframe
      ref={ref}
      src={url}
      title="Pixel Office"
      onLoad={() => setLoaded(true)}
      style={{ width: '100%', height: 382, border: 0, display: 'block' }}
    />
  );
}
```

`users` 는 `{ id, name, status: 'online'|'offline', characterId? }[]` 로 매핑해서 넘긴다.

**Vanilla / 서버 렌더링(JSP, Thymeleaf 등)**

```html
<iframe id="po" title="Pixel Office" style="width:100%;height:382px;border:0"></iframe>
<script>
  const po = document.getElementById('po');
  const src = new URL('/pixel-office/index.html', location.href);
  src.searchParams.set('me', CURRENT_USER_ID);
  src.searchParams.set('demo', '0'); // ws 사용 시 대신 src.searchParams.set('ws', 'wss://...')
  src.searchParams.set('parentOrigin', location.origin);
  po.src = src;
  po.addEventListener('load', () => pushRoster(EMPLOYEES));
  function pushRoster(users) {
    po.contentWindow.postMessage({ type: 'pixel-office:roster', users }, src.origin);
  }
</script>
```

### 3.6 실시간 공유 (선택)

말풍선/위치/철퇴를 다른 사람에게 보이게 하려면 **호스트 백엔드에 WebSocket 엔드포인트**를 `PROTOCOL.md` 대로 구현한다.
없으면 각자 화면에서만 동작한다 (근태 표시는 postMessage 만으로 충분).

서버 구현 체크리스트 (`PROTOCOL.md` 4절 요약):

- [ ] 사용자 식별은 **세션 쿠키/토큰**. `hello.id` 및 메시지 내 `id` 신뢰 금지
- [ ] 브로드캐스트 메시지의 `id` 는 서버가 세션 기준으로 채움
- [ ] 핸드셰이크 `Origin` 검증, 메시지 크기 제한(1KB)
- [ ] `chat`: 제어문자 제거·trim·40자, 빈도 제한(500ms)
- [ ] `punish`: 발신자가 `online` 일 때만, 빈도 제한(3초)
- [ ] 접속 종료 시 `leave` 브로드캐스트
- [ ] 근태 변경 시 `status` 푸시(선택)

참고 구현: `dev/mock-server.js` 의 `parseClientMessage`, `sanitizeText`.

## 4. 코드 구조 (`index.html` 스크립트)

하나의 IIFE. 섹션 구분 주석(`// ───────── 이름 ─────────`) 순서대로:

| 섹션            | 주요 식별자                                                    | 내용                                                          |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| 스프라이트 정의 | `BODIES`, `HATS`, `CHARACTERS`, `sprite()`                     | 16×16 문자열 픽셀아트 → offscreen canvas 캐시(좌우 반전 포함) |
| 입력 검증       | `cleanText`, `validId`, `validStatus`, `validChar`, `parseUrl` | 모든 외부 입력은 여기를 통과                                  |
| 설정            | `ME`, `WS_URL`, `PARENT_ORIGIN`, `DEMO`                        | URL 파라미터 파싱                                             |
| 화면/존         | `resize()`, `zones`, `zoneFor()`, `zoneOf()`                   | 논리 해상도 `W × 112`, 바닥 `GROUND=96`                       |
| 엔티티          | `entities`(Map), `upsert()`, `setStatus()`, `say()`            | 직원 1명 = 엔티티 1개                                         |
| 네트워크        | `connect()`, `handleServer()`, `send()`, `message` 리스너      | WebSocket(지수 백오프 재연결) + postMessage                   |
| 입력            | canvas `keydown`, `openChat()`, `closeChat()`                  | **캔버스 포커스 시에만** 키 처리                              |
| 캐릭터 선택     | `pick()`, `renderBar()`                                        | 하단 ◀ ▶ 바, localStorage 저장                                |
| 업데이트        | `step()`, `startPunish()`, `endPunish()`, `syncMe()`           | 이동/배회/점프/철퇴 상태머신                                  |
| 그리기          | `draw()`, `drawEntity()`, `drawPunish()`, `drawBubble()` 등    | 매 프레임 전체 다시 그림                                      |
| 데모 모드       | `startDemo()`                                                  | `ws` 없고 `demo≠0` 일 때만                                    |
| 시작            | `requestAnimationFrame(loop)`, `window.__pixelOffice`          | 테스트용 읽기 전용 `getState()`                               |

### 엔티티 필드

`id, name, status, characterId, x(논리 px), y(점프 오프셋, ≤0), vy, facing(1|-1), target(자동 이동 목표 x), remoteNX(원격 위치 0~1), autopilot(내 캐릭터 자동 출퇴근 중), walking, wanderAt, bubble{text,until}, isMe, fromRoster, punish{start,moved}, respawnWait, blinkUntil`

### 이동 우선순위 (`step()`)

1. `punish` 진행 중 → 정지, `PUNISH_END` 경과 시 `endPunish()`
2. `respawnWait` (관전자 화면에서 부활 위치 대기) → 숨김
3. 내 캐릭터: 키 입력 > `autopilot` 목표
4. 원격 사용자: `remoteNX` 따라감
5. 그 외: 자기 존 안에서 랜덤 배회

### 철퇴 연출 흐름

```
[본인] ← 키 + status=online + x ≤ 집 존 끝+PUNISH_RANGE
   → startPunish(local): move(현재 위치) 즉시 전송 → punish 전송
   → 0~700ms 낙하, 700~1000ms 화면 흔들림, ~2200ms 배너
   → endPunish: zoneFor(status) 에서 부활 → 다음 프레임 syncMe 가 move 전송
[관전자] punish 수신 → 같은 연출 → 연출 중 move 받았으면 그 위치에서 부활,
         못 받았으면 최대 1500ms 숨긴 채 move 대기 (없으면 자기 존 랜덤)
```

`punish` 직전에 `move` 를 보내는 이유: WebSocket 은 순서를 보장하므로, 관전자가 punish 이후 받는 move 는 부활 위치뿐이게 된다. 이 순서를 바꾸지 말 것.

## 5. 반드시 지킬 불변식

1. **네트워크 x 는 비율(0~1)**. 접속자마다 화면 폭(`W`)이 다르므로 px 로 보내지 말 것
2. **사용자 텍스트는 canvas `fillText` 또는 `textContent` 로만 출력**. `innerHTML` 금지 (XSS 테스트 있음)
3. 외부 입력(postMessage, WebSocket, URL 파라미터)은 `cleanText`/`validId`/`validStatus`/`validChar`/`parseUrl` 를 거칠 것
4. postMessage 는 `ev.origin === PARENT_ORIGIN` 이고 `ev.source` 가 부모 창(또는 자기 창)일 때만 처리
5. 키 입력은 캔버스 포커스일 때만 (호스트 대시보드 단축키 간섭 방지)
6. 한글 IME: 입력창 Enter 처리에서 `ev.isComposing` 체크 유지 (없으면 조합 중 Enter 로 마지막 글자가 잘림)
7. `characterId` 형식 `[a-z0-9-]{1,32}` — 서버(`CHAR_RE`)도 같은 규칙으로 검증
8. `dev/mock-server.js` 는 운영 사용 금지

## 6. 자주 하는 수정

**캐릭터 추가** — `CHARACTERS` 배열에 한 줄:

```js
['worker-teal', '청록모자 기획자', 'worker', { H: '#1abc9c', T: '#1abc9c' }, 'helmet'],
// [id, 표시이름, 몸체(BODIES 키), 팔레트 덮어쓰기, 모자(HATS 키, worker 전용·선택)]
```

**몸체 추가** — `BODIES` 에 `{ rows: 16줄×16자, alt: { from: 행번호, rows: [...] }, palette: { 문자: '#색' } }`.
`.` 은 투명, 오른쪽을 바라보게 그린다(왼쪽은 자동 반전). `alt` 는 걷기 2번째 프레임에서 교체할 행.
행 길이가 16이 아니면 깨지므로 추가 후 길이를 검증할 것.

**철퇴 조정** — 상수 `PUNISH_TEXT`(멘트), `PUNISH_RANGE`(집 존 끝에서 발동 거리 px), `PUNISH_FALL`/`PUNISH_SHAKE`/`PUNISH_END`(ms).

**속도/물리** — `SPEED_ME`, `SPEED_COMMUTE`, `SPEED_WANDER`(px/s), `GRAVITY`.

**존 위치** — `zones.home()` = `[16, 104]`, `zones.office()` = `[W-108, W-16]`. 건물 그림(`drawHouse`, `drawOffice`)과 같이 옮길 것.

**폰트** — CSS 변수 `--po-font`. 한글 폰트가 없는 환경(헤드리스 리눅스 등)에서는 한글이 □ 로 보인다. 코드 문제 아님.

**말풍선 길이** — `MAX_CHAT`(클라이언트), `MAX_CHAT_LEN`(mock 서버), input `maxlength` 세 곳을 함께 바꿀 것.

## 7. 검증

```bash
npm install && npx playwright install chromium
npm run lint && npm run format:check
npm test            # node:test(mock 서버) + Playwright E2E (mock 서버 자동 기동, 포트 8799)
npm run dev         # 수동 확인: http://localhost:8787/index.html?me=kim&ws=ws://localhost:8787
```

`index.html` 을 브라우저에서 파일로 직접 열어도 데모 모드로 동작한다.
상태 확인: 콘솔에서 `window.__pixelOffice.getState()` (`entities[].zone` 은 `home`/`office`/`road`).

## 8. 알려진 함정

- 일부 편집 도구가 정규식 안의 `​` 같은 이스케이프를 실제 보이지 않는 문자로 바꿔 저장한다. ESLint `no-irregular-whitespace` 가 잡으니 lint 를 꼭 돌릴 것
- 사람이 매우 많으면(수십 명) 한 존에 몰려 겹친다. 이름표는 겹치면 자동 생략되고, 내 이름표와 말풍선 있는 사람이 우선 표시된다
- GitHub Pages 는 현재 `feature/pixel-office` 브랜치 루트를 배포한다
