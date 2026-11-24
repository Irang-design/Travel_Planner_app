const endpoint = 'https://maps.apigw.ntruss.com/map-direction/v1/driving';
const nonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

function formatPoint(point) {
  const { longitude, latitude } = point ?? {};
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw new TypeError('출발지와 목적지의 WGS84 경도·위도를 숫자로 입력해 주세요.');
  }
  return [longitude, latitude].map(value => value.toFixed(7)).join(',');
}

const unavailable = () => ({ status: 'unavailable', mode: 'driving', message: '자동차 경로 확인 불가' });

export async function get_routes(origin, destination, signal = AbortSignal.timeout(10000)) {
  const start = formatPoint(origin);
  const goal = formatPoint(destination);
  if (start === goal) return unavailable();

  const id = process.env.NAVER_MAPS_CLIENT_ID?.trim();
  const secret = process.env.NAVER_MAPS_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error('서버의 NAVER Maps 인증 정보를 설정해 주세요.');

  const url = new URL(endpoint);
  url.search = new URLSearchParams({ start, goal, option: 'traoptimal' });
  const response = await fetch(url, {
    headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
    redirect: 'error',
    signal
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`NAVER Maps 자동차 경로 조회 실패 (HTTP ${response.status})`);
  }
  const data = await response.json();
  if (response.status === 400 && [1, 2, 3, 5].includes(data?.code)) return unavailable();
  if (!response.ok || data?.code !== 0) throw new Error('NAVER Maps 경로 응답을 처리할 수 없습니다.');

  const route = data.route?.traoptimal?.[0];
  if (!route) return unavailable();
  const { distance, duration } = route.summary ?? {};
  if (!nonNegativeInteger(distance) || !nonNegativeInteger(duration)) {
    throw new Error('NAVER Maps 응답에 유효한 거리 또는 소요 시간이 없습니다.');
  }
  return {
    status: 'available',
    mode: 'driving',
    distanceMeters: distance,
    distanceKm: distance / 1000,
    durationMs: duration,
    durationMinutes: Math.ceil(duration / 60000),
    path: Array.isArray(route.path) ? route.path.filter(point => Array.isArray(point) &&
      point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) : []
  };
}
