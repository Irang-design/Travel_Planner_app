const endpoint = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const grids = { 제주도: [52, 38], 부산: [98, 76], 강릉: [92, 131], 경주: [100, 91], 전주: [63, 89] };
const source = 'https://www.data.go.kr/data/15084084/openapi.do';
const midSource = 'https://www.data.go.kr/data/15059468/openapi.do';
const midEndpoint = 'https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst';
const midZones = [
  [/제주|서귀포/, '11G00000', '제주도'],
  [/부산|울산|경남|경상남도|창원|김해|진주|거제|통영/, '11H20000', '부산·울산·경남'],
  [/대구|경북|경상북도|경주|포항|안동|구미/, '11H10000', '대구·경북'],
  [/강릉|속초|양양|동해|삼척|고성군/, '11D20000', '강원 영동'],
  [/춘천|원주|홍천|횡성|철원|영월/, '11D10000', '강원 영서'],
  [/서울|인천|경기|수원|성남|고양|용인/, '11B00000', '서울·인천·경기'],
  [/대전|세종|충남|충청남도|천안|공주|보령/, '11C20000', '대전·세종·충남'],
  [/충북|충청북도|청주|충주|제천/, '11C10000', '충북'],
  [/전북|전라북도|전주|군산|익산|남원/, '11F10000', '전북'],
  [/광주|전남|전라남도|여수|순천|목포|나주/, '11F20000', '광주·전남']
];
const hours = [23, 20, 17, 14, 11, 8, 5, 2];
const dayMs = 86400000;
const dateString = time => new Date(time).toISOString().slice(0, 10);
const compact = date => date.replaceAll('-', '');

function midPublication(now) {
  const issued = new Date(now - 25 * 60000);
  const hour = issued.getUTCHours();
  return { date: dateString(issued.getTime() - (hour < 6 ? dayMs : 0)), time: hour < 6 || hour >= 18 ? '1800' : '0600' };
}

export function weatherAvailableThrough() {
  const publication = midPublication(Date.now() + 9 * 3600000);
  return dateString(Date.parse(publication.date) + 10 * dayMs);
}

async function forecastItems(endpoint, params) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ dataType: 'JSON', pageNo: '1', ...params });
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error('기상청 예보 조회 실패');
  const data = (await response.json()).response;
  if (data?.header?.resultCode === '03') return [];
  if (data?.header?.resultCode !== '00' || !Array.isArray(data.body?.items?.item)) throw new Error('기상청 예보 응답 확인 불가');
  return data.body.items.item;
}

function midReading(item, offset, date, forecastArea) {
  const suffixes = [String(offset), offset + 'Am', offset + 'Pm'];
  const probabilities = suffixes.map(suffix => item?.['rnSt' + suffix])
    .filter(value => String(value).match(/^\d{1,3}$/) && Number(value) <= 100).map(Number);
  const descriptions = suffixes.map(suffix => item?.['wf' + suffix]).filter(value => typeof value === 'string' && value.trim());
  if (!probabilities.length && !descriptions.length) return null;
  const maxRainProbability = probabilities.length ? Math.max(...probabilities) : null;
  return { date, status: 'forecast', source: midSource, forecastType: 'mid', forecastArea, maxRainProbability,
    rainExpected: descriptions.some(value => /비|소나기/.test(value)) || maxRainProbability >= 60, rainHours: [] };
}

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
  const grid = Object.hasOwn(grids, region) ? grids[region] : null;
  const shortRange = date => date >= today && date <= lastDate;
  const shortEligible = date => Boolean(grid) && shortRange(date);
  const mid = midPublication(now);
  const midOffset = date => (Date.parse(date) - Date.parse(mid.date)) / dayMs;
  const midRange = date => midOffset(date) >= 4 && midOffset(date) <= 10;
  const zone = midZones.find(([pattern]) => pattern.test(region));
  const midEligible = date => !shortEligible(date) && Boolean(zone) && midRange(date);
  let key = process.env.KMA_SERVICE_KEY?.trim();
  // The portal provides both URL-encoded and decoded keys.
  if (key) {
    try { key = decodeURIComponent(key); } catch { /* Keep a literal percent sign. */ }
  }
  const [nx, ny] = grid ?? [];
  const [shortItems, midItems] = await Promise.all([
    key && dates.some(shortEligible) ? forecastItems(endpoint, {
      serviceKey: key, numOfRows: '2000', base_date: compact(baseDate),
      base_time: String(baseHour).padStart(2, '0') + '00', nx, ny
    }).catch(() => null) : [],
    key && dates.some(midEligible) ? forecastItems(midEndpoint, {
      serviceKey: key, numOfRows: '1', regId: zone[1], tmFc: compact(mid.date) + mid.time
    }).catch(() => null) : []
  ]);
  return dates.map(date => {
    const short = shortEligible(date);
    const mid = midEligible(date);
    const unknown = reason => ({ date, status: 'unknown', reason, source: mid ? midSource : source, forecastType: mid ? 'mid' : 'short' });
    if (!short && !mid) return unknown((!zone && midRange(date)) || (!grid && shortRange(date))
      ? '이 지역의 예보 구역 미설정' : '단기·중기예보 조회 범위 밖');
    if (!key) return unknown('기상청 인증 키 미설정');
    if (mid) {
      if (midItems === null) return unknown('기상청 중기예보 조회 실패');
      return midReading(midItems[0], midOffset(date), date, zone[2]) ?? unknown('발표된 중기예보 없음');
    }
    if (shortItems === null) return unknown('기상청 단기예보 조회 실패');
    const rows = shortItems.filter(row => row.fcstDate === compact(date) &&
      (date !== today || Number(row.fcstTime) >= currentHour * 100));
    const precipitation = rows.filter(row => row.category === 'PTY' && /^[0-4]$/.test(String(row.fcstValue)));
    const probabilities = rows.filter(row => row.category === 'POP' && /^\d{1,3}$/.test(String(row.fcstValue)))
      .map(row => Number(row.fcstValue)).filter(value => value <= 100);
    if (!precipitation.length && !probabilities.length) return unknown('발표된 단기예보 없음');
    const maxRainProbability = probabilities.length ? Math.max(...probabilities) : null;
    return {
      date, status: 'forecast', source, forecastType: 'short', maxRainProbability,
      rainExpected: precipitation.some(row => ['1', '2', '4'].includes(String(row.fcstValue))) || maxRainProbability >= 60,
      rainHours: precipitation.filter(row => ['1', '2', '4'].includes(String(row.fcstValue)))
        .map(row => String(row.fcstTime).replace(/^(\d{2})(\d{2})$/, '$1:$2'))
    };
  });
}
