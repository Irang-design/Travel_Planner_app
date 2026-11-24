const places = {
  제주도: ['성산일출봉|자연|분화구와 바다가 함께 보이는 전망', '성산 해산물 식당가|맛집|제주 해산물로 점심', '섭지코지|관광|해안 산책로 따라 걷기', '함덕해수욕장|휴식|바다를 보며 쉬어 가기', '동문시장|쇼핑|제주 간식과 기념품 둘러보기', '비자림|자연|숲길을 천천히 산책', '고기국수 거리|맛집|제주식 고기국수 맛보기', '아르떼뮤지엄 제주|관광|미디어 아트 전시 관람', '애월 카페 거리|휴식|해안 전망과 커피', '제주 민속오일시장|쇼핑|지역 특산품 구경'],
  강릉: ['경포호|자연|호숫가 산책', '초당순두부마을|맛집|순두부로 점심', '오죽헌|관광|전통 건축 둘러보기', '안목해변|휴식|바다를 보며 커피 한 잔', '강릉중앙시장|쇼핑|시장 간식과 특산품 구경'],
  부산: ['이기대 해안산책로|자연|해안 절벽과 바다 감상', '자갈치시장|맛집|해산물로 점심', '감천문화마을|관광|골목 풍경 둘러보기', '광안리해수욕장|휴식|해변에서 여유로운 시간', '국제시장|쇼핑|시장 골목과 상점 탐방'],
  경주: ['보문호|자연|호반길 산책', '황리단길 식당가|맛집|한옥 골목에서 점심', '대릉원|관광|신라 고분과 정원 탐방', '교촌한옥마을|휴식|한옥 골목 산책', '경주중앙시장|쇼핑|지역 간식과 특산품 구경'],
  전주: ['전주천 산책길|자연|물길 따라 걷기', '남부시장 식당가|맛집|전주식 콩나물국밥', '경기전|관광|전통 건축과 정원 관람', '전주한옥마을|휴식|한옥 카페에서 쉬어 가기', '전주공예품전시관|쇼핑|지역 공예품 둘러보기']
};
const form = document.querySelector('#planner');
const panel = document.querySelector('#panel');
const tabs = [...document.querySelectorAll('[role=tab]')];
const money = value => new Intl.NumberFormat('ko-KR').format(value) + '원';
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
const offsetDate = (start, days) => new Date(Date.parse(start + 'T00:00:00Z') + days * 86400000);
const tastes = [['맛집','🍴'],['관광','⌖'],['자연','♧'],['휴식','☕'],['쇼핑','◇']];
document.querySelector('#tastes').innerHTML = tastes.map(([taste, icon]) =>
  `<label><input type="checkbox" name="taste" value="${taste}" ${['맛집','자연'].includes(taste) ? 'checked' : ''}><span>${icon} ${taste}</span></label>`
).join('');
form.elements.start.value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

let plan;
let activeTab = 'plan';
let activeDay = 0;
let failedTrace = null;
const lodgingByPlan = new WeakMap();

function readConditions() {
  const data = new FormData(form);
  const region = data.get('region').trim();
  const days = Number(data.get('days'));
  const people = Number(data.get('people'));
  const budget = Number(data.get('budget'));
  const transport = data.get('transport');
  const request = data.get('request').trim();
  const chosen = data.getAll('taste');
  const start = data.get('start');
  const maxStops = Number(data.get('maxStops'));
  const maxTravelMinutes = Number(data.get('maxTravelMinutes')) || null;
  return { region, days, people, budget, transport, request, chosen, start, maxStops, maxTravelMinutes };
}

function buildSamplePlan(conditions) {
  const { region, days, people, transport, chosen } = conditions;
  const catalog = places[region].map(entry => entry.split('|'));
  const ordered = [...catalog.filter(entry => chosen.includes(entry[1])), ...catalog.filter(entry => !chosen.includes(entry[1]))];
  const startTimes = transport === '자동차' ? ['09:30','12:10','14:30'] : ['10:00','12:30','15:00'];
  const itinerary = Array.from({ length: days }, (_, day) => Array.from({ length: 3 }, (_, stop) =>
    [startTimes[stop], ...ordered[(day * 3 + stop) % ordered.length]]
  ));
  const costs = [
    ['교통', days * (transport === '자동차' ? 55000 : transport === '대중교통' ? 11000 * people : 0)],
    ['숙박', (days - 1) * Math.ceil(people / 2) * 93000],
    ['식비', days * people * 29000],
    ['체험·입장료', days * people * 8500]
  ];
  return { ...conditions, itinerary, costs, source: 'sample' };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function dayControls() {
  return `<div class="day-pills" aria-label="여행 날짜">${plan.itinerary.map((_, index) =>
    `<button type="button" data-day="${index}" aria-pressed="${index === activeDay}">${index + 1}일차 · ${dateFormat.format(offsetDate(plan.start, index))}</button>`).join('')}</div>`;
}

function sourceLink(url, label) {
  return /^https?:\/\//i.test(url ?? '')
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : '';
}

function placeSource(place) {
  if (!place) return '';
  const url = place.sourceUrl || 'https://map.naver.com/p/search/' + encodeURIComponent(`${place.name} ${place.address}`.trim());
  return sourceLink(url, place.sourceUrl ? 'NAVER 검색 결과 · 장소 페이지' : 'NAVER 지도에서 장소 검색');
}

function travelTime(route) {
  const limit = plan.maxTravelMinutes;
  if (!route) return limit ? '이동시간과 제한 충족 여부 확인 불가' : '이동시간 확인 불가';
  const exceeded = limit && route.durationMs > limit * 60000;
  return `자동차로 약 ${route.durationMinutes}분 · ${route.distanceKm}km${exceeded ? ` · 요청한 ${limit}분 초과` : ''}`;
}

function weatherNote(weather) {
  if (!weather) return '';
  const forecast = weather.status === 'forecast'
    ? `${weather.rainExpected ? '비 가능성 있음' : '예보에서 비 신호 없음'}${weather.maxRainProbability === null ? '' : ` · 최고 강수확률 ${weather.maxRainProbability}%`}`
    : `미확인 · ${escapeHtml(weather.reason)}`;
  const label = weather.forecastType === 'mid' ? '기상청 중기예보' : '기상청 단기예보';
  const area = weather.forecastArea ? ` · ${escapeHtml(weather.forecastArea)} 권역` : '';
  return `<p class="note place-source">날씨 · ${forecast}${area} · ${sourceLink(weather.source, label)}</p>`;
}

function weatherWindow() {
  if (!plan.weatherAvailableThrough) return '';
  const date = dateFormat.format(offsetDate(plan.weatherAvailableThrough, 0));
  return `<p class="details">이 일정 생성 시점 기준, 날씨는 최대 <strong>${date}</strong>까지 조회할 수 있어요. 지역과 기상청 발표 여부에 따라 예보가 없을 수 있습니다.</p>`;
}

const budgetNotices = new WeakMap();
function budgetEditor(budget, costs) {
  return `<details class="budget-editor"><summary>예산 수정</summary>
    <p class="details">직접 수정한 금액은 추정치로 표시합니다. 비용을 모르면 칸을 비워 두세요.</p>
    <form id="edit-budget">
      <label class="field">총예산 (원)<input type="number" name="total" min="1" max="100000000" step="1" value="${budget}" required></label>
      <div class="pair">${costs.map(([label, value]) =>
        `<label class="field">${escapeHtml(label)} (원)<input name="cost" type="number" min="0" max="100000000" step="1" value="${value ?? ''}" placeholder="미확인"></label>`).join('')}</div>
      <button type="submit" class="submit">예산 반영</button>
      <p class="feedback error" id="budget-error" role="alert"></p>
    </form>
  </details><p class="feedback" role="status">${escapeHtml(budgetNotices.get(plan) ?? '')}</p>`;
}

function validationReport(report) {
  if (!report) return '';
  const conflicts = report.issues.filter(issue => issue.severity === 'conflict');
  const unknown = report.issues.filter(issue => issue.severity === 'unknown');
  const list = issues => `<ul>${issues.map(issue => `<li>${issue.day ? `${issue.day}일차 · ` : ''}${escapeHtml(issue.message)}</li>`).join('')}</ul>`;
  return `<section class="note validation-report" aria-label="일정 검증">
    <h3>일정 검증</h3>
    <p>재계획 ${report.replans}회 · 남은 충돌 ${conflicts.length}건 · 확인 필요 ${unknown.length}건</p>
    ${report.repairFailed ? '<p>재계획을 마치지 못해 검증 결과가 가장 좋은 일정을 표시합니다.</p>' : ''}
    ${!report.repairFailed && report.replans === 2 && conflicts.length ? '<p>재계획 한도에 도달했습니다. 아래 충돌을 확인해 주세요.</p>' : ''}
    ${conflicts.length ? `<h4>남은 충돌</h4>${list(conflicts)}` : ''}
    ${report.resolved.length ? `<h4>수정 이유 · 해결된 충돌</h4>${list(report.resolved)}` : ''}
    ${report.changes.length ? `<details><summary>수정 전후 일정</summary><ul>${report.changes.map(change =>
      `<li><strong>${change.day}일차</strong><br>수정 전 · ${escapeHtml(change.before)}<br>수정 후 · ${escapeHtml(change.after)}</li>`).join('')}</ul></details>` : ''}
    ${unknown.length ? `<details><summary>확인 필요 ${unknown.length}건</summary>${list(unknown)}</details>` : ''}
  </section>`;
}

function render() {
  clearTripMap();
  renderLodging();
  const { region, days, people, budget, transport, request, start, itinerary, costs, source } = plan;
  const ai = source === 'ai';
  document.querySelector('.mode').lastChild.textContent = plan.savedId ? ' 저장된 일정' : ai ? ' AI 일정' : ' 샘플 모드';
  document.querySelector('.sample').textContent = plan.savedId ? '저장된 일정' : ai ? 'AI 생성 일정' : '샘플 일정';
  document.querySelector('.footer > span:last-child').textContent = plan.savedId ? '국내 여행 플래너 · 브라우저 저장본' : ai ? '국내 여행 플래너 · AI 생성 일정' : '국내 여행 플래너 · 샘플 데이터';
  const date = dateFormat.format(offsetDate(start, activeDay));
  const stops = itinerary[activeDay];
  document.querySelector('#trip').textContent = plan.savedTitle ?? region + ' ' + (days === 1 ? '당일치기' : `${days - 1}박 ${days}일`);
  document.querySelector('#meta').textContent = `${dateFormat.format(offsetDate(start, 0))} 출발 · ${people}명 · ${transport} · ${money(budget)}`;
  panel.setAttribute('aria-labelledby', 'tab-' + activeTab);

  if (activeTab === 'plan') {
    panel.innerHTML = dayControls() + `<h3 class="day-title">${activeDay + 1}일차 · ${date}</h3>${weatherNote(plan.weather?.[activeDay])}${weatherWindow()}<ol class="timeline">${stops.map(([time, name, category, detail, place, route, visit], index) =>
      `<li><time>${escapeHtml(time)}</time><span class="pin"></span><div><b>${escapeHtml(name)}</b><p class="details">${escapeHtml(category)} · ${escapeHtml(detail)}${visit?.endTime ? ` · ${escapeHtml(visit.endTime)}까지` : ''}</p>
        ${index ? `<p class="details travel-time">앞 장소에서 · ${travelTime(route)}</p>` : ''}
        ${visit?.hours ? `<p class="details place-source">${sourceLink(visit.hours.sourceUrl, '방문일 운영시간 출처')}</p>` : ''}
        ${place ? `<p class="details place-source">${escapeHtml(place.address)} ${placeSource(place)}</p>` : ''}</div></li>`).join('')}</ol>`;
    panel.innerHTML += validationReport(plan.validation);
    if (plan.locallyEdited) panel.innerHTML += '<p class="note">저장본에서 수정한 일정입니다. 변경 후 서버 검증은 수행되지 않았습니다.</p>';
    const webSources = plan.webSources ?? [...new Set((plan.trace ?? []).filter(item => item.name === 'web_search').flatMap(item => item.sources ?? []))];
    if (webSources.length) panel.innerHTML += `<details class="place-source"><summary>웹 검색 출처 ${webSources.length}개</summary><ul class="log">${webSources.map(url => `<li>${sourceLink(url, url)}</li>`).join('')}</ul></details>`;
  } else if (activeTab === 'map' && ai) {
    panel.innerHTML = dayControls() + `<h3 class="day-title">${escapeHtml(region)} ${activeDay + 1}일차 방문 지도</h3>
      <div class="dynamic-map" id="trip-map" aria-label="NAVER 방문 장소 지도"></div><p class="details" id="trip-map-status" role="status"></p>
      <ol class="log">${stops.map(([, name, , , place, route], index) =>
        `<li><strong>${escapeHtml(name)}</strong>${place?.address ? `<p class="details">${escapeHtml(place.address)}</p>` : ''}
          ${index ? `<p class="details">${travelTime(route)}</p>` : ''}</li>`).join('')}</ol>`;
    void drawTripMap(panel.querySelector('#trip-map'), panel.querySelector('#trip-map-status'), stops);
  } else if (activeTab === 'map') {
    panel.innerHTML = dayControls() + `<h3 class="day-title">${region} ${activeDay + 1}일차 이동 순서</h3>
      <svg class="map" viewBox="0 0 480 172" role="img" aria-label="방문 순서를 표시한 개략 지도">
      <path fill="#f0f3e4" d="M0 0H480V121Q390 90 307 133T112 140Q40 125 0 162Z"/>
      <path fill="none" stroke="#fff" stroke-width="5" d="M0 35L480 132M0 103L480 25M82 0L120 172M330 0L290 172"/>
      <path fill="none" stroke="#278260" stroke-width="4" stroke-dasharray="7 5" d="M93 110Q170 115 240 65T385 100"/>
      ${[[93,110],[240,65],[385,100]].map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="15" fill="#17654b" stroke="white" stroke-width="3"/><text x="${x}" y="${y+5}" text-anchor="middle" fill="white" font-size="14">${i+1}</text>`).join('')}</svg>
      <ol class="log">${stops.map(([,name]) => `<li>${escapeHtml(name)}</li>`).join('')}</ol><p class="details">${transport} 이동 · 방문 순서 개략도</p>`;
  } else if (activeTab === 'budget') {
    const known = costs.filter(([, value]) => value !== null);
    const total = known.reduce((sum, [, value]) => sum + value, 0);
    const remaining = budget - total;
    const partial = known.length < costs.length;
    panel.innerHTML = `<table class="budget-table"><caption>예상 비용 · ${people}명 기준</caption>
      <thead><tr><th scope="col">항목</th><th scope="col">금액</th><th scope="col">상태</th></tr></thead>
      <tbody>${costs.map(([label, value, status]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${value === null ? '—' : money(value)}</td><td>${value === null ? '미확인' : status === 'estimated' || !ai ? '추정' : '입력 금액'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">총예산</th><td>${money(budget)}</td><td></td></tr>
      <tr><th scope="row">${partial ? '비용 소계' : '비용 합계'}</th><td>${known.length ? money(total) : '미확인'}</td><td></td></tr>
      <tr><th scope="row">${known.length && remaining < 0 ? '예산 초과' : '잔여 예산'}</th><td>${known.length ? money(Math.abs(remaining)) : '미확인'}</td><td>${known.length && partial ? '미확인 항목 제외' : ''}</td></tr></tfoot></table>`;
    if (ai) panel.innerHTML += budgetEditor(budget, costs);
  } else {
    const trace = failedTrace ?? plan.trace ?? [];
    panel.innerHTML = `<h3 class="day-title">Agent 실행 기록${failedTrace ? ' · 생성 실패' : ''}</h3>`;
    if (!trace.length) panel.innerHTML += '<p class="details">호출된 도구가 없습니다.</p>';
    else {
      panel.innerHTML += `<ol class="log">${trace.map(({ name, summary, sources = [] }) =>
        `<li><strong>${escapeHtml(name)}</strong><p class="details">${escapeHtml(summary)}</p>${sources.length
          ? `<ul>${sources.map(url => `<li>${sourceLink(url, url)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`;
    }
  }
  if (request && ['plan','log'].includes(activeTab)) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = (ai ? '추가 요청 · ' : '추가 요청(참고용) · ') + request;
    panel.append(note);
  }
}

function selectTab(tab) {
  activeTab = tab.dataset.tab;
  tabs.forEach(item => {
    item.setAttribute('aria-selected', String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  });
  render();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const next = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
});
panel.addEventListener('click', event => {
  const dayButton = event.target.closest('[data-day]');
  if (!dayButton) return;
  activeDay = Number(dayButton.dataset.day);
  render();
  panel.querySelector('[aria-pressed=true]').focus();
});
const submitButton = form.querySelector('.submit');
const status = document.querySelector('#status');
const errorMessage = document.querySelector('#plan-error');
const submitLabel = submitButton.textContent;

panel.addEventListener('submit', async event => {
  const editor = event.target;
  if (editor.id !== 'edit-budget') return;
  event.preventDefault();
  if (submitButton.disabled) return;
  const current = plan;
  const data = new FormData(editor);
  const budget = Number(data.get('total'));
  const amounts = data.getAll('cost').map(value => value === '' ? null : Number(value));
  const button = editor.querySelector('button[type="submit"]');
  button.disabled = submitButton.disabled = true;
  refreshRevisionControls();
  editor.querySelector('#budget-error').textContent = '';
  try {
    if (current.planId) {
      const response = await fetch('/api/plan/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: current.planId, budget, amounts }),
        signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new Error(result?.error || '예산을 반영하지 못했습니다.');
      const validation = current.validation && { ...current.validation, issues: result.issues,
        resolved: current.validation.resolved.filter(issue => !result.issues.some(currentIssue => currentIssue.code === issue.code)) };
      plan = { ...current, planId: result.planId, budget: result.budget, costs: result.costs, validation };
      previousPlan = current;
    } else {
      const costs = current.costs.map((item, index) => amounts[index] === item[1] ? item :
        [item[0], amounts[index], amounts[index] === null ? 'unknown' : 'estimated']);
      plan = { ...current, costs, budget, validation: null, locallyEdited: true };
    }
    form.elements.budget.value = plan.budget;
    budgetNotices.set(plan, plan.savedId ? '예산을 반영했습니다. 저장본에 남기려면 현재 일정 저장을 눌러 주세요.' : '예산을 반영했습니다.');
    render();
  } catch (error) {
    const feedback = panel.querySelector('#budget-error');
    if (feedback) feedback.textContent = error.message;
  } finally {
    button.disabled = submitButton.disabled = false;
    refreshRevisionControls();
  }
});
const revisionForm = document.querySelector('#revision-form');
const revisionInput = revisionForm.elements.message;
const revisionButton = revisionForm.querySelector('button');
const undoButton = document.querySelector('#undo-revision');
const revisionMessages = document.querySelector('#revision-messages');
const revisionHint = document.querySelector('#revision-hint');
const revisionError = document.querySelector('#revision-error');
const revisionStatus = document.querySelector('#revision-status');
let previousPlan = null;
let revisionPending = false;

function refreshRevisionControls() {
  const busy = submitButton.disabled || revisionPending;
  revisionInput.disabled = revisionButton.disabled = busy || !plan?.planId;
  undoButton.disabled = busy || !previousPlan;
  revisionHint.textContent = plan?.planId
    ? '바꾸고 싶은 날짜, 장소 또는 시간을 적어 주세요.'
    : plan?.savedId ? '저장된 여행 계획 목록에서 일정을 직접 수정할 수 있어요.' : 'AI 일정을 만들면 수정 요청을 보낼 수 있어요.';
}

function appendRevisionMessage(speaker, message, changes = []) {
  const bubble = document.createElement('div');
  bubble.className = 'revision-message';
  const heading = document.createElement('strong');
  heading.textContent = speaker;
  const content = document.createElement('p');
  content.textContent = message;
  bubble.append(heading, content);
  for (const change of changes) {
    const details = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = `${change.day}일차 수정 이유 · ${change.reason ?? '요청한 일정 반영'}`;
    const before = document.createElement('p');
    before.textContent = '수정 전 · ' + change.before;
    const after = document.createElement('p');
    after.textContent = '수정 후 · ' + change.after;
    details.append(title, before, after);
    bubble.append(details);
  }
  revisionMessages.append(bubble);
  revisionMessages.scrollTop = revisionMessages.scrollHeight;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitButton.disabled) return;
  const conditions = readConditions();
  submitButton.disabled = true;
  refreshRevisionControls();
  submitButton.textContent = 'AI 일정 만드는 중…';
  status.textContent = '여행 조건에 맞춰 일정을 만들고 있어요.';
  errorMessage.textContent = '';
  failedTrace = null;
  panel.setAttribute('aria-busy', 'true');
  const started = performance.now();
  const progress = setInterval(() => {
    const seconds = Math.floor((performance.now() - started) / 1000);
    status.textContent = seconds >= 15
      ? `일정 생성이 진행 중입니다. 장소 검색이나 경로 확인이 포함되면 더 걸릴 수 있어요. · ${seconds}초 경과`
      : `여행 조건에 맞춰 일정을 만드는 중… · ${seconds}초 경과`;
  }, 5000);

  try {
    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conditions),
      signal: AbortSignal.timeout(145000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      if (result?.trace?.length) {
        failedTrace = result.trace;
        selectTab(tabs.find(tab => tab.dataset.tab === 'log'));
      }
      errorMessage.textContent = result?.error || '서버 응답을 받지 못했습니다. 다시 시도해 주세요.';
      status.textContent = '';
      return;
    }
    plan = { ...conditions, ...result, source: 'ai' };
    document.querySelector('#save-trip-form')?.reset();
    previousPlan = null;
    revisionMessages.replaceChildren();
    revisionError.textContent = '';
    revisionStatus.textContent = '';
    revisionForm.reset();
    activeDay = 0;
    selectTab(tabs[0]);
    status.textContent = `${plan.region} ${plan.days}일 여행 일정을 만들었습니다.`;
    document.querySelector('#results').scrollIntoView({ block: 'nearest' });
  } catch (error) {
    status.textContent = '';
    errorMessage.textContent = error.name === 'TimeoutError'
      ? '응답이 너무 오래 걸렸어요. 여행 기간이나 추가 요청을 줄여 다시 시도해 주세요.'
      : '여행 일정을 불러오지 못했어요. 서버 연결을 확인하고 다시 시도해 주세요.';
  } finally {
    clearInterval(progress);
    submitButton.disabled = false;
    refreshRevisionControls();
    submitButton.textContent = submitLabel;
    panel.removeAttribute('aria-busy');
  }
});
const lodgingForm = document.querySelector('#lodging-form');
const lodgingButton = lodgingForm.querySelector('button');
const lodgingHint = document.querySelector('#lodging-hint');
const lodgingStatus = document.querySelector('#lodging-status');
const lodgingError = document.querySelector('#lodging-error');
const lodgingResults = document.querySelector('#lodging-results');

function renderLodging() {
  const state = lodgingByPlan.get(plan);
  lodgingButton.disabled = !plan.planId || !!state?.pending;
  lodgingHint.textContent = plan.planId ? `${plan.region} 일정의 주요 방문지까지 자동차 이동시간을 비교합니다.` : 'AI 일정을 만든 뒤 숙소를 비교할 수 있어요.';
  lodgingStatus.textContent = state?.pending ? '숙소 후보와 자동차 이동시간을 확인하는 중…' : '';
  lodgingError.textContent = state?.error ?? '';
  const result = state?.result;
  if (!result) {
    lodgingResults.innerHTML = '';
    return;
  }
  const budget = result.budget;
  const bookingNote = {
    unavailable: '공식 예약 페이지를 확인할 수 없었습니다.',
    checked: result.candidates.some(candidate => candidate.bookingUrl)
      ? '공식 사이트에서 확인된 예약 페이지에만 링크를 표시합니다.'
      : '검색 결과에서 확인된 공식 예약 페이지가 없습니다.',
    not_requested: ''
  }[result.bookingStatus];
  lodgingResults.innerHTML = `<div class="note">
    <strong>${budget.nights ? `${budget.nights}박 숙소 비교 기준` : '당일치기 · 숙소 참고용 비교'}</strong>
    <p>여행 총예산 ${money(budget.totalBudget)} · ${budget.available < 0
      ? `숙박비를 제외하고도 예산 ${money(-budget.available)} 초과`
      : `반영된 다른 비용을 뺀 잠정 잔액 ${money(budget.available)}`}</p>
    <p>숙소 비교 상한 ${money(budget.comparisonLimit)}${budget.lodgingAllocation !== null ? ` · 일정에 입력된 숙박비 ${money(budget.lodgingAllocation)}` : ''}${budget.partial ? ' · 다른 비용에 추정·미확인 항목 포함' : ''}</p>
    <p>숙박 요금과 예약 가능 여부는 미확인입니다. 후보의 예산 충족 여부는 별도 확인이 필요합니다.</p>
    ${bookingNote ? `<p>${bookingNote}</p>` : ''}
  </div>
  <p class="details">${result.anchors.length ? `비교 방문지 · ${escapeHtml(result.anchors.join(' · '))}. 확인된 경로 수와 평균 이동시간을 기준으로 표시합니다.`
    : '일정에 좌표가 확인된 방문지가 없어 자동차 경로를 비교할 수 없습니다.'}</p>
  ${result.candidates.length ? `<ul class="place-list">${result.candidates.map(candidate => `<li>
    <strong>${escapeHtml(candidate.name)}</strong>
    <p class="details">${escapeHtml(candidate.category)} · ${escapeHtml(candidate.address)}</p>
    <p class="details place-source">${placeSource(candidate)}${candidate.bookingUrl ? ` · ${sourceLink(candidate.bookingUrl, '공식 예약 페이지')}` : ''}</p>
    ${candidate.routes.length ? `<ul class="lodging-routes">${candidate.routes.map(route =>
      `<li>${escapeHtml(route.destination)} · ${route.status === 'available' ? `자동차 약 ${route.durationMinutes}분 · ${route.distanceKm}km` : '자동차 경로 확인 불가'}</li>`).join('')}</ul>` : ''}
  </li>`).join('')}</ul>` : '<p class="details">이 여행 지역에서 숙소 후보를 찾지 못했습니다.</p>'}`;
}

lodgingForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (lodgingButton.disabled) return;
  const current = plan;
  const state = { ...lodgingByPlan.get(current), pending: true, error: '' };
  lodgingByPlan.set(current, state);
  renderLodging();
  try {
    const response = await fetch('/api/plan/lodging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: current.planId, verifyBooking: lodgingForm.elements.verifyBooking.checked })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.candidates) throw new Error(result?.error || '숙소 추천을 불러오지 못했습니다.');
    state.result = result;
  } catch (error) {
    state.error = error.message;
  } finally {
    state.pending = false;
    if (plan === current) renderLodging();
  }
});

plan = buildSamplePlan({ ...readConditions(), region: '제주도' });
render();
refreshRevisionControls();

const regionInput = form.elements.region;
const regionButton = document.querySelector('#search-region');
const regionStatus = document.querySelector('#region-feedback');
const regionResults = document.querySelector('#region-results');

regionInput.addEventListener('input', () => {
  regionStatus.textContent = '';
  regionResults.hidden = true;
});

regionButton.addEventListener('click', async () => {
  const region = regionInput.value.trim();
  if (region.length < 2) {
    regionStatus.textContent = '검색할 국내 지역 이름을 두 글자 이상 입력해 주세요.';
    regionInput.focus();
    return;
  }
  regionButton.disabled = true;
  regionResults.hidden = true;
  regionStatus.textContent = '입력한 지역의 관광지를 검색하는 중…';
  try {
    const query = new URLSearchParams({ region, keyword: '관광지' });
    const response = await fetch('/api/places?' + query, { signal: AbortSignal.timeout(13000) });
    const result = await response.json();
    if (regionInput.value.trim() !== region) return;
    if (!response.ok) throw new Error(result.error);
    regionStatus.textContent = result.places.length
      ? `‘${region}’ 검색 결과입니다. 입력한 지역으로 일정을 만들 수 있어요.`
      : `‘${region}’ 검색 결과가 없습니다. 시나 구 이름으로 검색해 보세요.`;
    regionResults.innerHTML = result.places.slice(0, 3).map(place =>
      `<li><strong>${escapeHtml(place.name)}</strong><p class="details">${escapeHtml(place.address)}</p></li>`).join('');
    regionResults.hidden = !result.places.length;
  } catch (error) {
    if (regionInput.value.trim() === region) regionStatus.textContent = error.message || '지역 검색에 실패했습니다.';
  } finally {
    regionButton.disabled = false;
  }
});

revisionForm.addEventListener('submit', async event => {
  event.preventDefault();
  const message = revisionInput.value.trim();
  if (revisionButton.disabled || !message) return;
  const current = plan;
  revisionPending = true;
  submitButton.disabled = true;
  revisionInput.value = '';
  revisionError.textContent = '';
  revisionStatus.textContent = '변경 요청을 반영하고 검증하는 중…';
  refreshRevisionControls();
  appendRevisionMessage('나', message);
  try {
    const response = await fetch('/api/plan/revise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: current.planId, message })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.revision) throw new Error(result?.error || '일정을 수정하지 못했습니다.');
    if (result.revision.applied) {
      previousPlan = current;
      const priorSources = current.webSources ?? (current.trace ?? []).filter(item => item.name === 'web_search').flatMap(item => item.sources ?? []);
      const newSources = result.trace.filter(item => item.name === 'web_search').flatMap(item => item.sources ?? []);
      plan = { ...current, ...result, webSources: [...new Set([...priorSources, ...newSources])] };
      failedTrace = null;
      if (result.revision.changes.length) activeDay = result.revision.changes[0].day - 1;
      selectTab(tabs[0]);
    }
    appendRevisionMessage('여행 Agent', result.revision.reply, result.revision.changes);
    revisionStatus.textContent = result.revision.applied ? '수정된 일정에 검증을 적용했습니다.' : '기존 일정이 유지되었습니다.';
  } catch (error) {
    revisionError.textContent = error.message;
    revisionStatus.textContent = '';
    revisionInput.value = message;
  } finally {
    revisionPending = false;
    submitButton.disabled = false;
    refreshRevisionControls();
  }
});

undoButton.addEventListener('click', () => {
  if (undoButton.disabled || !previousPlan) return;
  plan = previousPlan;
  form.elements.budget.value = plan.budget;
  previousPlan = null;
  failedTrace = null;
  selectTab(tabs[0]);
  revisionError.textContent = '';
  revisionStatus.textContent = '직전 수정을 되돌렸습니다.';
  appendRevisionMessage('여행 Agent', '직전 수정 전의 일정으로 되돌렸어요.');
  refreshRevisionControls();
});

const placeForm = document.querySelector('#place-form');
const placeStatus = document.querySelector('#place-status');
const placeError = document.querySelector('#place-error');
const placeResults = document.querySelector('#place-results');

placeForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = placeForm.querySelector('button');
  if (button.disabled) return;
  const region = form.elements.region.value.trim();
  const keyword = placeForm.elements.keyword.value.trim();
  if (!keyword) {
    placeError.textContent = '검색어를 입력해 주세요.';
    return;
  }

  button.disabled = true;
  placeStatus.textContent = region + ' 장소를 검색하는 중…';
  placeError.textContent = '';
  placeResults.replaceChildren();
  try {
    const query = new URLSearchParams({ region, keyword });
    const response = await fetch('/api/places?' + query);
    const result = await response.json();
    if (!response.ok) {
      placeStatus.textContent = '';
      placeError.textContent = result.error || '장소 검색에 실패했습니다.';
      return;
    }
    placeStatus.textContent = result.places.length
      ? `${region} · ${keyword} 검색 결과 ${result.places.length}개`
      : `${region} · ${keyword} 검색 결과가 없습니다.`;
    for (const place of result.places) {
      const row = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = place.name;
      row.append(name);
      for (const text of [place.category, place.address,
        place.latitude !== null && place.longitude !== null
          ? `위도 ${place.latitude} · 경도 ${place.longitude}` : '']) {
        if (!text) continue;
        const detail = document.createElement('p');
        detail.className = 'details';
        detail.textContent = text;
        row.append(detail);
      }
      placeResults.append(row);
      const source = document.createElement('p');
      source.className = 'details place-source';
      source.innerHTML = placeSource(place);
      row.append(source);
    }
  } catch {
    placeStatus.textContent = '';
    placeError.textContent = '장소 검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.';
  } finally {
    button.disabled = false;
  }
});
