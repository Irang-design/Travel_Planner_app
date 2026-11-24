import { search_places } from './search-places.js';
import { get_routes } from './get-routes.js';
import { calculate_budget } from './calculate-budget.js';
import { get_weather } from './get-weather.js';

export const costLabels = { transport: '교통', lodging: '숙박', food: '식비', activities: '체험·입장료' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const point = object({ longitude: { type: 'number' }, latitude: { type: 'number' } });
const expense = object({ amount: { type: ['integer', 'null'] }, status: { type: 'string', enum: ['confirmed', 'estimated', 'unknown'] } });
export const coordinateKey = point => `${point?.longitude},${point?.latitude}`;
export const routeKey = (origin, destination) => `${coordinateKey(origin)}>${coordinateKey(destination)}`;
const schema = (name, description, properties) => ({ type: 'function', name, description, strict: true, parameters: object(properties) });

export const agentTools = [
  schema('get_weather', '이 여행 기간의 기상청 단기예보와 범위 밖 날짜의 권역별 중기예보를 조회한다. 날씨 확인 요청이나 비에 영향을 받는 야외 일정에만 사용한다.', {}),
  schema('search_places', '여행 지역에서 장소명과 주소, 카테고리, 좌표를 검색한다.', { keyword: string }),
  schema('get_routes', '검색에서 확인한 두 WGS84 좌표 사이의 자동차 이동 거리와 예상 시간을 조회한다. 자동차 여행에서만 사용한다.', { origin: point, destination: point }),
  schema('calculate_budget', '사용자가 추가 요청에 원화로 명시한 항목별 여행 전체 금액을 합산한다. 미확인 항목은 amount를 null, status를 unknown으로 전달한다. 추정치라고 명시된 금액만 estimated로 표시한다.', {
    expenses: object(Object.fromEntries(Object.keys(costLabels).map(key => [key, expense])))
  }),
  { type: 'web_search' }
];

export async function executeTool(name, args, conditions, state) {
  switch (name) {
    case 'get_weather': {
      const dates = Array.from({ length: conditions.days }, (_, index) =>
        new Date(Date.parse(conditions.start) + index * 86400000).toISOString().slice(0, 10));
      const result = state.weatherQueried ? state.weather : await get_weather(conditions.region, dates).catch(() =>
        dates.map(date => ({
          date, status: 'unknown', reason: '기상청 예보 조회 실패',
          source: 'https://www.data.go.kr/data/15084084/openapi.do'
        })));
      state.weather = result;
      state.weatherQueried = true;
      const known = result.filter(day => day.status === 'forecast').length;
      const rainy = result.filter(day => day.rainExpected).map(day => day.date);
      const reasons = [...new Set(result.filter(day => day.status === 'unknown').map(day => day.reason))];
      return {
        result,
        summary: `예보 ${known}일 · 미확인 ${dates.length - known}일${rainy.length ? ' · 비 가능성 ' + rainy.join(', ') : ''}${reasons.length ? ' · ' + reasons.join(', ') : ''}`,
        sources: [...new Set(result.map(day => day.source))]
      };
    }
    case 'search_places': {
      const places = (await search_places(conditions.region, args.keyword)).map(place => {
        let index = state.places.size + 1;
        while (state.places.has(`place-${index}`)) index++;
        const id = `place-${index}`;
        const record = { ...place, id, query: `${conditions.region} ${args.keyword.trim()}` };
        state.places.set(id, record);
        if (place.longitude !== null && place.latitude !== null) state.coordinates.set(coordinateKey(place), record);
        return record;
      });
      return { result: places, summary: `${places.length}곳 · ${places.map(place => place.name).join(', ')}`.replace(/ · $/, '') };
    }
    case 'get_routes': {
      const origin = state.coordinates.get(coordinateKey(args.origin));
      const destination = state.coordinates.get(coordinateKey(args.destination));
      if (conditions.transport !== '자동차' || !origin || !destination) {
        return { result: { status: 'unavailable', message: '자동차 이동과 장소 검색 좌표가 필요합니다.' }, summary: '자동차 경로 확인 불가 · 이동수단 또는 좌표 확인 필요' };
      }
      const { path, ...result } = await get_routes(args.origin, args.destination);
      state.routes.set(routeKey(origin, destination), { ...result, path });
      const summary = result.status === 'available'
        ? `${result.distanceKm}km · 약 ${result.durationMinutes}분`
        : result.message;
      return { result, summary: `${origin.name} → ${destination.name} · ${summary}` };
    }
    case 'calculate_budget': {
      const allowedAmounts = new Set(Array.from(
        (state.budgetText ?? conditions.request).matchAll(/(?<![\d,.\-])\d+(?:,\d{3})*(?:\.\d+)?\s*(만원|원)/g),
        ([text, unit]) => Number(text.replace(/[,\s원만]/g, '')) * (unit === '만원' ? 10000 : 1)
      ));
      const items = Object.entries(costLabels).map(([key, category]) => {
        const expense = args.expenses?.[key];
        return allowedAmounts.has(expense?.amount) && ['confirmed', 'estimated'].includes(expense.status)
          ? { category, amount: expense.amount, status: expense.status }
          : { category, amount: null, status: 'unknown' };
      });
      const result = calculate_budget(conditions.budget, items.map((item, index) =>
        item.amount === null && state.costs[index]?.amount != null ? state.costs[index] : item));
      state.costs = result.items;
      return { result, summary: `소계 ${result.subtotal.toLocaleString('ko-KR')}원 · 미확인 ${result.unknownCount}건` };
    }
    default:
      throw new Error('Unknown tool');
  }
}
