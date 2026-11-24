# 어디로 · 국내 여행 Agent

Node.js 24와 npm이 설치된 환경에서 실행합니다.

```powershell
npm.cmd ci
npm.cmd run dev
```

[로컬 여행 플래너](http://127.0.0.1:3000)는 처음에 샘플 일정을 보여줍니다. 여행 조건을 제출하면 `POST /api/plan`이 OpenAI Responses API를 호출합니다. AI 일정 생성에는 `.env`의 OpenAI 키와 구조화된 출력을 지원하는 모델이 필요합니다. `GET /api/health`는 서버 상태를 반환합니다.

AI 일정의 **대화로 일정 수정**에서 날짜·장소·시간 변경을 요청할 수 있습니다. `POST /api/plan/revise`는 현재 일정과 요청을 같은 Agent Loop에 전달하고 검증 결과를 반환합니다. 변경 대상에서 제외된 날짜는 서버에서 그대로 유지합니다. 직전 수정 되돌리기는 열린 화면에서 한 번 사용할 수 있습니다. 서버가 발급하는 암호화된 일정 세션은 24시간 동안 유효합니다. Vercel 또는 여러 서버 인스턴스를 사용하는 환경에서는 같은 세션 키를 설정합니다.

**일정에 맞는 숙소**는 NAVER 지역 검색으로 후보를 찾고, 일정에 좌표가 있는 주요 방문지 최대 두 곳까지의 자동차 이동시간을 비교합니다. 숙박 예산 비교 상한은 총예산에서 반영된 비숙박 비용을 빼고, 입력된 숙박비가 있으면 그 금액도 고려해 계산합니다. 금액을 확인할 수 없는 숙소는 가격이나 예산 충족 여부를 추정하지 않습니다. 공식 예약 페이지 확인 옵션은 웹에서 확인된 숙소 홈페이지 도메인의 예약 링크만 표시합니다.

**저장된 여행 계획**에서 일정을 브라우저에 보관하고, 다시 열거나 방문 시간·장소·메모를 직접 수정하고, 삭제하거나 JSON으로 내보낼 수 있습니다. 브라우저 저장 데이터에는 서버 측 API 키, 일정 세션 ID, 원본 자유 입력, 채팅 기록을 포함하지 않습니다. 다시 연 저장본의 수동 변경은 재검색이나 서버 검증을 실행하지 않습니다.

## 프로젝트 구조

- `public/`에는 HTML, CSS, JavaScript와 이미지가 있습니다. 초기 샘플과 서버에서 생성한 AI 일정을 표시합니다.
- `src/server.js`는 Express 서버 진입점입니다. 정적 파일은 `public/`에서만 제공합니다.
- `src/plan.js`는 여행 조건을 검증하고 공식 SDK로 구조화된 일정과 예상 경비를 받습니다.
- `src/agent-loop.js`는 모델이 선택한 함수만 실행하고 같은 `call_id`로 결과를 돌려줍니다. 최초 일정은 Responses 요청 최대 8회, 각 재계획은 최대 4회이며 재계획은 최대 2회입니다. 전체 응답 대기 120초를 적용합니다.
- `src/agent-tools.js`는 서버 함수와 내장 `web_search`를 등록합니다. 설정한 OpenAI 모델은 함수 호출, Structured Outputs, 웹 검색을 지원해야 합니다. 실제 호출과 결과는 Agent 실행 기록에 표시됩니다.
- `src/validate-itinerary.js`는 비용, 방문 수, 자동차 구간 시간, 일정 중복, 운영시간과 날씨 충돌을 검사합니다. 이동시간 상한을 지정하지 않으면 구간당 90분을 사용합니다. 운영시간은 해당 방문 날짜와 실제 웹 검색 출처가 있는 경우에만 검사합니다. 근거가 없으면 확인 필요로 표시합니다.
- 자동차 이동시간은 NAVER 경로 조회가 성공했을 때 해당 날짜의 일정과 지도에 표시됩니다. 예산에 반영하려면 추가 요청에 항목별 여행 전체 금액을 입력합니다. 예를 들어 `숙박비 총 180,000원, 식비 총 12만원 추정`처럼 적습니다. 금액이 없는 항목은 미확인으로 표시합니다.
- `src/get-routes.js`의 `get_routes(출발지, 목적지)`는 검색 결과의 숫자형 `{ longitude, latitude }`를 받아 NAVER Maps Directions 5 자동차 경로를 조회합니다. 거리(m, km)와 조회 시점의 예상 소요 시간(ms, 올림한 분)을 반환합니다. 경로를 제공할 수 없는 경우 `status: 'unavailable'`을 반환합니다. [Directions 5](https://api.ncloud-docs.com/docs/application-maps-directions5)
- `src/calculate-budget.js`의 `calculate_budget(총예산, 비용항목)`는 원화 비용 항목 `{ category, amount, status }`를 합산합니다. `status`는 `confirmed`, `estimated`, `unknown` 중 하나이며 미확인 금액은 `null`입니다. 미확인 항목이 있으면 소계와 잔여액은 알려진 금액만 반영하고 결과에 `partial`을 표시합니다.
- `.env.example`에는 변수 이름이 있습니다. 새 환경에서는 이 파일을 `.env`로 복사하고 연동 단계에 필요한 값만 채웁니다.

## 개발 순서

Level 2 맞춤 일정에서는 하루 최대 방문 장소를 1~5곳으로 지정할 수 있습니다. 이동 제한은 연속 방문 장소 사이의 구간별 상한입니다. 확인된 자동차 시간이 상한을 넘으면 표시하며, 도보·대중교통 또는 미조회 구간의 제한 충족 여부는 미확인으로 표시합니다.

Agent는 사용자가 날씨를 요청하거나 야외 일정 판단에 필요할 때만 `get_weather`를 선택합니다. 날짜별 일정에 조회한 예보를 표시하고, 비가 예상되는 날짜에 야외 일정이 있다면 실내 후보를 검색할 수 있습니다. 지역 대표 격자의 기상청 단기예보를 사용하므로 장소별 미세한 차이와 단기예보 범위 밖의 날짜는 확인할 수 없습니다.

| 단계 | 범위 |
| --- | --- |
| Level 1 | OpenAI Responses API로 날짜별 일정과 예상 예산을 생성합니다. 구현 완료. |
| Level 2 | NAVER API HUB 지역 검색을 별도 화면과 Agent 도구에서 사용합니다. |
| Level 3 | Agent가 필요한 경우 신규 Maps 자동차 경로와 예산 계산을 호출합니다. AI 일정의 지도 탭은 확인된 장소와 자동차 경로를 NAVER Web Dynamic Map에 표시합니다. |

연동을 시작할 때 공급자별 호출 코드를 `src/services/`에, 일정 생성과 도구 실행을 조율하는 코드를 `src/agent/`에 둡니다.

## 인증 정보

- 공공데이터포털의 기상청 단기예보 서비스 키를 `KMA_SERVICE_KEY`로 설정합니다. 키가 없거나 단기예보가 제공되지 않는 날짜는 미확인으로 표시됩니다. [기상청 단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do)

- OpenAI는 `OPENAI_API_KEY`와 `OPENAI_MODEL`을 사용합니다. [OpenAI SDK](https://developers.openai.com/api/reference/typescript)
- 지역 검색에는 NAVER API HUB에서 발급받은 ID와 시크릿을 `NAVER_API_HUB_CLIENT_ID`, `NAVER_API_HUB_CLIENT_SECRET`에 넣습니다. [NAVER API HUB 이관 안내](https://developers.naver.com/notice/article/32530)
- 장소 검색은 `GET /api/places?region=제주도&keyword=카페`에서 최대 5개 결과를 반환합니다. 좌표는 WGS84 십진도이며, 누락되거나 해석할 수 없는 좌표는 `null`입니다. [지역 검색 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)
- 신규 Maps에는 별도로 발급받은 ID와 시크릿을 `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`에 넣습니다. [NAVER Cloud Maps 문서](https://api.ncloud-docs.com/docs/en/application-maps-overview)
- NAVER Cloud 콘솔에서 Web Dynamic Map을 활성화하고 앱을 여는 웹 서비스 URL을 등록합니다. 별도 웹 지도 ID가 있다면 `NAVER_MAPS_WEB_CLIENT_ID`로 지정합니다. 브라우저에는 지도 SDK에 필요한 공개 Client ID만 제공됩니다. [Web Dynamic Map Client ID 설정](https://navermaps.github.io/maps.js.en/docs/tutorial-1-Getting-Client-ID.html)

Client Secret과 OpenAI API 키는 서버의 `.env`에 보관합니다. `.env`는 Git 추적 대상에서 제외되며, Git에는 빈 예제인 `.env.example`만 추가합니다.

## GitHub와 Vercel 배포

### GitHub에 코드 올리기

`git --version`으로 설치 여부를 확인합니다. Windows에서 Git이 없다면 [Git for Windows](https://git-scm.com/download/win)를 설치한 뒤 터미널을 다시 엽니다. 새 GitHub 저장소를 만들 때 README나 초기 커밋을 추가하지 않습니다. Git 작성자 정보가 아직 없다면 이 저장소에 사용할 이름과 이메일을 설정합니다.

```powershell
git config user.name "YOUR_NAME"
git config user.email "YOUR_EMAIL"
git status --short
git check-ignore .env
git diff --cached --name-only
git commit -m "Prepare travel planner deployment"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

이 프로젝트는 `.gitignore`와 `.vercelignore`에서 로컬 환경 파일, 인증서, 이전 샘플 배포 폴더를 제외합니다. `.env.example`에는 실제 키 값이 없습니다. [GitHub 업로드 안내](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

### Vercel 프로젝트와 환경변수

1. Vercel의 **Add New → Project**에서 GitHub 저장소를 가져옵니다. Root Directory는 저장소 루트, Node.js 버전은 **24.x**를 사용합니다. Express를 자동 감지하며, 루트의 `public/`은 정적 파일로 제공됩니다. Fluid Compute를 사용합니다. [Vercel Express 배포](https://vercel.com/docs/frameworks/backend/express)
2. **Settings → Environment Variables**에서 아래 값을 등록합니다. 먼저 **Production**에 적용하고, Preview 테스트가 필요할 때만 Preview에도 별도 적용합니다. 환경변수를 바꾸면 새로 배포합니다. [Vercel 환경변수](https://vercel.com/docs/environment-variables)

| 변수 | 값 |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI 키와 Responses API의 함수 호출, 구조화된 출력 및 웹 검색을 지원하는 모델 |
| `NAVER_API_HUB_CLIENT_ID`, `NAVER_API_HUB_CLIENT_SECRET` | NAVER API HUB 지역 검색 앱 인증 정보 |
| `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET` | NAVER Cloud Maps Directions 5 인증 정보 |
| `NAVER_MAPS_WEB_CLIENT_ID` | 브라우저 Web Dynamic Map을 별도 앱으로 등록한 경우 그 공개 Client ID. 생략 시 Maps Client ID 사용 |
| `KMA_SERVICE_KEY` | 기상청 단기예보 서비스 키. 설정 전 날씨는 미확인으로 표시 |
| `PLAN_SESSION_SECRET` | 필수. 아래 명령으로 생성한 64자리 값을 Vercel의 Sensitive 환경변수로 등록. 같은 값을 유지해야 기존 일정 세션이 유지됨 |

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

OpenAI와 NAVER Secret 및 기상청 키도 서버 환경에 등록합니다. 브라우저에는 Web Dynamic Map 공개 Client ID만 제공됩니다. 비용이 발생하는 API를 공개하려면 접근 보호를 적용하고, 공개 서비스는 Vercel Firewall에서 `/api/plan`과 하위 경로에 요청 한도를 설정합니다. 방화벽의 속도 제한 지원 여부는 사용하는 플랜을 확인합니다. [Vercel Firewall 속도 제한](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)

### NAVER 지도 주소 등록

NAVER Cloud Console의 **Services → Application Services → Maps → Application**에서 배포에 사용하는 지도 앱을 엽니다. **Web Dynamic Map**을 활성화하고 **Web 서비스 URL**에 실제 Vercel 사이트 주소를 등록합니다. 사용자 지정 도메인으로 접속한다면 그 주소도 등록합니다. 미리보기에서 지도를 검증할 경우 사용하는 Preview 주소를 추가합니다. Directions 5가 다른 앱의 키를 사용한다면 해당 앱에서 **Directions 5**가 활성화됐는지 함께 확인합니다. [NAVER Maps Client ID 등록 안내](https://navermaps.github.io/maps.js.en/docs/tutorial-1-Getting-Client-ID.html)

### 배포 후 검증

```powershell
npm.cmd run smoke:deploy -- https://YOUR-PROJECT.vercel.app
```

이 명령은 서버 상태, 정적 파일, 지도 공개 설정, NAVER 지역 검색, OpenAI 일정 생성, 후속 숙소 요청의 NAVER 자동차 경로를 실제 호출로 검증합니다. 보호된 배포에는 인증된 브라우저를 사용하거나, 자동화 보호 우회가 활성화된 프로젝트에서 로컬 환경변수 `VERCEL_AUTOMATION_BYPASS_SECRET`을 설정해 실행합니다. 우회 키를 명령이나 URL에 붙이지 않습니다. 브라우저에서는 AI 일정의 지도 탭을 열어 실제 지도 타일과 마커를 확인합니다. [Vercel 보호된 배포 테스트](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection)
