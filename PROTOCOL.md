# Pixel Office 연동 스펙 (대시보드 팀용)

Pixel Office(`index.html`)는 iframe으로 삽입되며, 두 채널로 데이터를 받는다.

1. **postMessage** — 대시보드 페이지 → iframe. 직원 목록과 근태 상태 주입
2. **WebSocket** — 대시보드 백엔드 ↔ 모든 접속자. 위치·말풍선·캐릭터 실시간 공유

## 1. iframe 삽입

```html
<iframe
  id="pixel-office"
  src="https://<호스트>/pixel-office/index.html?me=<로그인 사용자 id>&ws=wss://<백엔드>/pixel-office&parentOrigin=https://<대시보드 origin>"
  style="width:100%;border:0"
  height="380"
></iframe>
```

| 파라미터       | 필수 | 설명                                                                                                     |
| -------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `me`           | O    | 현재 로그인 사용자 id. `[A-Za-z0-9_.-]{1,32}`                                                            |
| `ws`           | O    | WebSocket URL (`ws:`/`wss:` 만 허용). 없으면 데모 모드(가짜 직원, 로컬 전용)로 동작                      |
| `parentOrigin` | 권장 | postMessage 를 허용할 부모 origin(`https://host[:port]`). 잘못된 값/생략 시 iframe 자신의 origin 만 허용 |
| `demo=0`       | -    | ws 없이 데모 직원/이벤트 없이 실행 (postMessage 만 사용하는 경우)                                        |

높이: 화면 폭 기준 캔버스 높이 = `112 × scale`(scale = 폭/384 내림, 최대 3) + 하단 바 약 36px.

## 2. postMessage (대시보드 → iframe)

`iframe.contentWindow.postMessage(msg, '<iframe origin>')`

### 전체 로스터 (목록에 없는 직원은 화면에서 제거)

```json
{
  "type": "pixel-office:roster",
  "users": [{ "id": "kim", "name": "김하늘", "status": "online", "characterId": "worker-red" }]
}
```

### 단일 상태 변경 (캐릭터가 집 ↔ 회사로 걸어감)

```json
{ "type": "pixel-office:status", "id": "kim", "status": "offline" }
```

- `status`: `"online"`(회사) | `"offline"`(집)
- `name`: 최대 20자, 제어문자 제거됨
- `characterId`: 생략/미지 값이면 id 해시로 자동 배정. 사용 가능 id 는 `window.__pixelOffice.getState().characters`

## 3. WebSocket 프로토콜

모든 메시지는 JSON 텍스트 프레임. `x` 는 **화면 폭 대비 비율(0~1)** — 접속자마다 화면 폭이 다르기 때문.

### 클라이언트 → 서버

| type     | 필드                      | 설명                                             |
| -------- | ------------------------- | ------------------------------------------------ |
| `hello`  | `id`                      | 접속 직후 1회. **서버는 이 값을 신뢰 금지**      |
| `move`   | `x`(0~1), `facing`(1\|-1) | 내 캐릭터 위치. 최대 10회/초                     |
| `chat`   | `text`                    | 말풍선. 1~40자                                   |
| `char`   | `characterId`             | 캐릭터 변경. `[a-z0-9-]{1,32}`                   |
| `punish` | `effect`, `to`(0~1)       | 출근 중 집 접근 → 퇴근 방지 효과 시작. 3초에 1회 |

### 서버 → 클라이언트

| type       | 필드                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| `snapshot` | `users`: `[{id,name,status,characterId,x\|null,facing}]`                         |
| `move`     | `id`, `x`, `facing`                                                              |
| `chat`     | `id`, `text`, `ts`                                                               |
| `char`     | `id`, `characterId`                                                              |
| `status`   | `id`, `status` — 근태 변경 시 서버가 푸시 (선택)                                 |
| `leave`    | `id` — 해당 사용자 연결 종료 (클라이언트는 원격 위치 추적만 해제, 캐릭터는 유지) |
| `punish`   | `id`, `effect`, `to` — 해당 캐릭터에 같은 효과 재생 후 `to` 위치에서 부활        |

접속 시 및 신규 사용자 합류 시 `snapshot` 브로드캐스트. 미지 type 은 클라이언트가 무시한다.

## 4. 서버 보안 요구사항 (필수)

- **사용자 식별은 세션 쿠키/토큰으로**. `hello.id` 나 메시지 안의 `id` 를 신뢰하지 말 것. 브로드캐스트 메시지의 `id` 는 서버가 세션 기준으로 채운다 (클라이언트가 보낸 `id` 무시)
- WebSocket 핸드셰이크에서 `Origin` 헤더 검증
- `chat.text`: 제어문자 제거 + trim + 40자 제한, 사용자당 빈도 제한(참고 구현: 500ms)
- 메시지 크기 제한 (참고 구현: 1KB), 잘못된 JSON/스키마는 무시
- `punish`: 발신자가 `online` 일 때만 중계, 사용자당 빈도 제한(참고 구현: 3초). `effect` 는 `[a-z-]{1,16}` 형식만 검사하고 그대로 전달(효과 목록을 서버가 알 필요 없음, 모르는 값은 클라이언트가 기본 효과로 재생), `to` 는 0~1 숫자로 보정
- 말풍선은 저장하지 않아도 됨(휘발성)

참고 구현: `dev/mock-server.js` 의 `parseClientMessage`, `sanitizeText` (mock 은 데모용이라 `hello.id` 를 신뢰함 — 운영 금지)
