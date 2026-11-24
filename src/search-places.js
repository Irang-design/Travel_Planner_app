const endpoint = 'https://naverapihub.apigw.ntruss.com/search/v1/local';
const clean = value => typeof value === 'string' ? value.trim() : '';

class PlaceSearchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function coordinate(value, limit) {
  const raw = clean(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  // NAVER's WGS84 integer example uses seven implied decimal places.
  const degrees = /^-?\d{8,}$/.test(raw) ? number / 1e7 : number;
  return Math.abs(degrees) <= limit ? degrees : null;
}

export async function search_places(region, keyword, signal = AbortSignal.timeout(10000)) {
  region = clean(region);
  keyword = clean(keyword);
  if (!region || region.length > 50 || !keyword || keyword.length > 80) {
    throw new PlaceSearchError(400, '여행 지역과 검색어를 확인해 주세요.');
  }

  const id = clean(process.env.NAVER_API_HUB_CLIENT_ID);
  const secret = clean(process.env.NAVER_API_HUB_CLIENT_SECRET);
  if (!id || !secret) throw new PlaceSearchError(503, '서버의 NAVER API HUB 인증 정보를 설정해 주세요.');

  const url = new URL(endpoint);
  url.search = new URLSearchParams({ query: `${region} ${keyword}`, display: '5', format: 'json' });
  const response = await fetch(url, {
    headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
    redirect: 'error',
    signal
  });
  if (response.status === 401 || response.status === 403) {
    throw new PlaceSearchError(502, 'NAVER API HUB 인증 정보와 지역 검색 사용 권한을 확인해 주세요.');
  }
  if (response.status === 429) throw new PlaceSearchError(503, 'NAVER 지역 검색 요청 한도를 확인해 주세요.');
  if (!response.ok) throw new PlaceSearchError(502, 'NAVER 지역 검색에 실패했습니다.');
  const data = await response.json();
  if (!Array.isArray(data?.items)) throw new PlaceSearchError(502, 'NAVER 지역 검색 응답을 읽을 수 없습니다.');

  return data.items.filter(item => clean(item?.title)).map(item => ({
    name: clean(item.title).replace(/<\/?b>/gi, '').trim(),
    address: clean(item.roadAddress) || clean(item.address),
    category: clean(item.category),
    sourceUrl: /^https?:\/\//i.test(clean(item.link)) ? clean(item.link) : null,
    longitude: coordinate(item.mapx, 180),
    latitude: coordinate(item.mapy, 90)
  })).filter(place => place.name);
}

export async function listPlaces(request, response) {
  try {
    const places = await search_places(request.query.region, request.query.keyword);
    return response.json({ places });
  } catch (error) {
    if (error instanceof PlaceSearchError) return response.status(error.status).json({ error: error.message });
    if (error.name === 'TimeoutError') return response.status(504).json({ error: '장소 검색 시간이 초과되었습니다.' });
    return response.status(502).json({ error: '장소 검색에 연결하지 못했습니다. 다시 시도해 주세요.' });
  }
}
