const endpoint = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const grids = { 제주도: [52, 38], 부산: [98, 76], 강릉: [92, 131], 경주: [100, 91], 전주: [63, 89] };
const source = 'https://www.data.go.kr/data/15084084/openapi.do';
const hours = [23, 20, 17, 14, 11, 8, 5, 2];
const dayMs = 86400000;
const dateString = time => new Date(time).toISOString().slice(0, 10);
const compact = date => date.replaceAll('-', '');

export async function get_weather(region, dates) {
  if (!Array.isArray(dates) || dates.length < 1 || dates.length > 5 ||
      dates.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || dateString(Date.parse(date)) !== date)) {
    throw new TypeError('날씨 조회 지역과 날짜를 확인해 주세요.');
  }
  const now = Date.now() + 9 * 3600000;
  const today = dateString(now);
  const currentHour = new Date(now).getUTCHours();
  // Give the latest publication time at least 15 minutes to reach the API.
  const issuedBy = new Date(now - 15 * 60000);
  const issueHour = hours.find(hour => hour <= issuedBy.getUTCHours());
  const baseDate = dateString(issuedBy.getTime() - (issueHour === undefined ? dayMs : 0));
  const baseHour = issueHour ?? 23;
  const lastDate = dateString(Date.parse(baseDate) + (baseHour >= 17 ? 4 : 3) * dayMs);
  const eligible = date => date >= today && date <= lastDate;
  const unknown = (date, reason) => ({ date, status: 'unknown', reason, source });
  if (!Object.hasOwn(grids, region)) return dates.map(date => unknown(date, '이 지역의 예보 격자 미설정'));
  if (!dates.some(eligible)) return dates.map(date => unknown(date, '단기예보 조회 범위 밖'));
  let key = process.env.KMA_SERVICE_KEY?.trim();
  if (!key) return dates.map(date => unknown(date, eligible(date) ? '기상청 인증 키 미설정' : '단기예보 조회 범위 밖'));
  // The portal provides both URL-encoded and decoded keys.
  try { key = decodeURIComponent(key); } catch { /* Keep a literal percent sign. */ }
  const [nx, ny] = grids[region];
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    serviceKey: key, dataType: 'JSON', pageNo: '1', numOfRows: '2000',
    base_date: compact(baseDate), base_time: String(baseHour).padStart(2, '0') + '00', nx, ny
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error('기상청 예보 조회 실패');
  const data = (await response.json()).response;
  if (data?.header?.resultCode === '03') return dates.map(date => unknown(date, eligible(date) ? '발표된 예보 없음' : '단기예보 조회 범위 밖'));
  if (data?.header?.resultCode !== '00' || !Array.isArray(data.body?.items?.item)) throw new Error('기상청 예보 응답 확인 불가');
  return dates.map(date => {
    if (!eligible(date)) return unknown(date, '단기예보 조회 범위 밖');
    const rows = data.body.items.item.filter(row => row.fcstDate === compact(date) &&
      (date !== today || Number(row.fcstTime) >= currentHour * 100));
    const precipitation = rows.filter(row => row.category === 'PTY' && /^[0-4]$/.test(String(row.fcstValue)));
    const probabilities = rows.filter(row => row.category === 'POP' && /^\d{1,3}$/.test(String(row.fcstValue)))
      .map(row => Number(row.fcstValue)).filter(value => value <= 100);
    if (!precipitation.length && !probabilities.length) return unknown(date, '발표된 예보 없음');
    const maxRainProbability = probabilities.length ? Math.max(...probabilities) : null;
    return {
      date, status: 'forecast', source, maxRainProbability,
      rainExpected: precipitation.some(row => ['1', '2', '4'].includes(String(row.fcstValue))) || maxRainProbability >= 60,
      rainHours: precipitation.filter(row => ['1', '2', '4'].includes(String(row.fcstValue)))
        .map(row => String(row.fcstTime).replace(/^(\d{2})(\d{2})$/, '$1:$2'))
    };
  });
}
