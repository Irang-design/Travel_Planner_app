import assert from 'node:assert/strict';

const target = process.argv[2];
if (!target) throw new Error('Usage: npm run smoke:deploy -- https://YOUR-PROJECT.vercel.app');
const base = new URL(target);
const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:')) || base.username || base.password) {
  throw new Error('An HTTPS deployment origin or a local HTTP origin is required.');
}

async function call(path, body, json = true) {
  const headers = {};
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(150000)
  });
  assert.equal(response.status, 200, `${path.split('?')[0]} returned HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

assert.equal((await call('/api/health')).status, 'ok');
assert.match(await call('/', null, false), /trip-map\.js/);
assert.match(await call('/trip-storage.js', null, false), /localStorage/);
const map = await call('/api/map-config');
assert.deepEqual(Object.keys(map), ['clientId']);
assert.ok(map.clientId, 'Public NAVER Maps Client ID is missing');
const places = await call('/api/places?' + new URLSearchParams({ region: '부산', keyword: '해운대 관광지' }));
assert.ok(places.places.length, 'NAVER API HUB returned no results');
console.log('Health, static assets, map configuration and NAVER place search passed.');

const start = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const plan = await call('/api/plan', {
  region: '부산', start, days: 1, people: 2, budget: 200000, transport: '자동차',
  request: '해운대 관광지를 한 번 검색한 뒤 결과에서 서로 다른 장소 두 곳을 방문 일정에 넣어 주세요.',
  chosen: ['관광'], maxStops: 2
});
assert.ok(plan.planId && plan.itinerary[0].length);
assert.ok(plan.itinerary[0].some(stop => Number.isFinite(stop[4]?.latitude)), 'No itinerary stop has verified coordinates');
const lodging = await call('/api/plan/lodging', { planId: plan.planId });
assert.ok(lodging.candidates.some(candidate => candidate.routes.some(route => route.status === 'available')), 'NAVER Maps returned no verified driving route');
console.log('OpenAI itinerary, cross-request plan session and NAVER driving routes passed.');
