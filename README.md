# Pixel Office

사내 근태 대시보드 상단에 들어가는 레트로 도트 게임 배너.
직원 캐릭터가 근태 상태에 따라 **집(Offline) ↔ 회사(Online)** 를 걸어 다니고,
내 캐릭터는 화살표로 움직이며 Enter 로 말풍선을 띄울 수 있다 (접속자 전원에게 실시간 표시).

## 기능

- 오리지널 도트 캐릭터 38종 (10개 몸체 × 색상/모자 변형), 하단 ◀ ▶ 로 선택 (localStorage 저장)
- 캔버스 클릭 → `← →` 이동, `↑`/`Space` 점프, `Enter` 말하기(최대 40자, 5초 표시), `Esc` 취소
- 근태 변경 시 출퇴근 애니메이션, 시간대별 하늘색(낮/저녁/밤)
- 단일 HTML 파일, 외부 의존성 없음 → iframe 으로 삽입

## 실행

```bash
npm install
npx playwright install chromium   # E2E 테스트 시에만
npm run dev                       # mock 서버: http://localhost:8787
```

- 데모 모드(서버 없이): `http://localhost:8787/index.html` (또는 `index.html` 을 브라우저로 직접 열기)
- 실시간 모드: `http://localhost:8787/index.html?me=kim&ws=ws://localhost:8787` 를 탭 2개(`me=kim`, `me=lee`)로 열기
- 근태 변경 시뮬레이션: `http://localhost:8787/admin/status?id=kim&status=offline`

## 대시보드 연동

iframe 삽입 방법, postMessage / WebSocket 메시지 스펙, 서버 보안 요구사항은 [PROTOCOL.md](PROTOCOL.md) 참고.
실시간 공유 서버는 대시보드 백엔드에서 구현해야 하며, `dev/mock-server.js` 는 개발·테스트용이다.

## 환경 변수

| 변수   | 사용처               | 기본값 | 설정 위치                                    |
| ------ | -------------------- | ------ | -------------------------------------------- |
| `PORT` | `dev/mock-server.js` | `8787` | 실행 시 셸에서 지정: `PORT=9000 npm run dev` |

`index.html` 은 비밀값이 없으며 설정은 모두 URL 파라미터(`me`, `ws`, `parentOrigin`, `demo`)로 받는다.

## 테스트 / 코드 품질

```bash
npm test          # node:test(mock 서버) + Playwright E2E
npm run lint      # ESLint (HTML 인라인 스크립트 포함)
npm run format    # Prettier
```

## 기술 스택

- HTML5 Canvas + Vanilla JS (빌드 없음)
- Node.js + `ws` (mock 서버)
- ESLint, Prettier, Playwright, node:test

## 구조

```
index.html            본체 (스프라이트, 게임 루프, 연동 로직)
dev/mock-server.js    개발용 WebSocket + 정적 서버
tests/                단위/E2E 테스트
PROTOCOL.md           대시보드 연동 스펙
```
