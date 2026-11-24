import { addressMatchesRegion } from './region-name.js';
import { search_places } from './search-places.js';

const gradeRequest = /(?:5\s*성\s*(?:급|호텔)|오\s*성급|별\s*5\s*개)/;
const excluded = /5\s*성급?\s*(?:호텔\s*)?(?:말고|제외)|숙박\s*(?:없|제외)|숙소\s*(?:빼|제외)/;
const nameKey = name => String(name ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const busanSource = 'https://kind.krx.co.kr/external/2026/04/06/000943/20260406002543/10002.htm';
const certified = [
  { name: '파라다이스호텔 부산', address: '부산광역시 해운대구 해운대해변로', sourceUrl: busanSource },
  { name: '웨스틴 조선 부산', address: '부산광역시 해운대구 동백로', sourceUrl: 'https://www.hotelrating.or.kr/hotel?lastGrade=5&page=4&size=10' },
  { name: '파크 하얏트 부산', address: '부산광역시 해운대구 마린시티1로', sourceUrl: busanSource },
  { name: '호텔농심', address: '부산광역시 동래구 금강공원로', sourceUrl: busanSource }
];

export function requestsFiveStar(request, revision = '') {
  return !excluded.test(revision || request) && (gradeRequest.test(revision) || gradeRequest.test(request));
}

export async function findFiveStarHotel(region, hotel, webGrade, sources) {
  if (hotel && webGrade?.sourceUrl && sources.has(webGrade.sourceUrl) && typeof webGrade.evidence === 'string' &&
      nameKey(webGrade.evidence).includes(nameKey(hotel)) && /5\s*성급?|5[- ]star/i.test(webGrade.evidence)) {
    return { name: hotel, sourceUrl: webGrade.sourceUrl };
  }
  const verified = certified.filter(item => addressMatchesRegion(item.address, region));
  const preferred = verified.find(item => nameKey(item.name) === nameKey(hotel));
  if (preferred) return preferred;

  const signal = AbortSignal.timeout(4500);
  const batches = await Promise.all(['5성급 호텔', '호텔 숙박'].map(keyword => search_places(region, keyword, signal).catch(() => [])));
  const local = batches.flat().filter(place => /숙박/.test(place.category) && /5성급?|특1급/.test(place.category) &&
    addressMatchesRegion(place.address, region)).map(place => ({
    name: place.name, sourceUrl: 'https://search.naver.com/search.naver?query=' + encodeURIComponent(`${place.name} 5성급`)
  }));
  return local.find(item => nameKey(item.name) === nameKey(hotel)) ?? local[0] ?? verified[0] ?? null;
}
