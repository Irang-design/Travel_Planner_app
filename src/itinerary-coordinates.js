import { search_places } from './search-places.js';

const area = { 제주도: '제주', 부산: '부산', 강릉: '강릉', 경주: '경주', 전주: '전주' };
const normalize = name => name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const comparisonName = (name, region) => {
  const normalized = normalize(name).replace(/해수욕장$/, '해변');
  const prefix = area[region];
  const stripped = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  return stripped.length >= 3 ? stripped : normalized;
};
const hasCoordinates = place => Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude);

export async function fillItineraryCoordinates(itinerary, region, trace, days = null) {
  const missing = new Map();
  itinerary.forEach((stops, day) => {
    if (days && !days.has(day + 1)) return;
    for (const stop of stops) {
      if (!hasCoordinates(stop[4]) && stop[1].length <= 80) missing.set(normalize(stop[1]), stop[1]);
    }
  });
  const found = new Map();
  const candidates = [...missing].slice(0, 15);
  const signal = AbortSignal.timeout(8000);
  for (let offset = 0; offset < candidates.length && !signal.aborted; offset += 5) {
    const batch = candidates.slice(offset, offset + 5);
    await Promise.all(batch.map(async ([key, name]) => {
      try {
        const places = (await search_places(region, name, signal)).filter(place => hasCoordinates(place) &&
          place.address.includes(area[region]));
        const exact = places.filter(place => normalize(place.name) === key);
        const matching = exact.length ? exact : places.filter(place =>
          comparisonName(place.name, region) === comparisonName(name, region));
        const byPoint = new Map(matching.map(place => [`${place.longitude},${place.latitude}`, place]));
        if (byPoint.size !== 1) return;
        const [[id, place]] = byPoint;
        found.set(key, { ...place, id: 'verified-' + id });
      } catch {
        // Keep an unresolved location when the upstream search is unavailable.
      }
    }));
  }
  if (candidates.length) trace.push({
    name: 'search_places',
    summary: `일정 지도 좌표 추가 확인 · ${found.size}/${candidates.length}곳 연결`
  });
  return itinerary.map((stops, day) => days && !days.has(day + 1) ? stops : stops.map(stop => {
    const place = found.get(normalize(stop[1]));
    return place && !hasCoordinates(stop[4]) ? stop.map((value, index) => index === 4 ? place : value) : stop;
  }));
}
