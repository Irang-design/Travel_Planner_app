import { search_places } from './search-places.js';
import { get_routes } from './get-routes.js';
import { addressMatchesRegion, regionPart } from './region-name.js';

const normalize = name => name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const comparisonName = (name, region) => {
  const normalized = normalize(name).replace(/해수욕장$/, '해변');
  const prefix = regionPart(region);
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
          addressMatchesRegion(place.address, region));
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

export async function fillItineraryRoutes(itinerary, trace, days = null) {
  const pairs = new Map();
  const keyOf = (from, to) => `${from.longitude},${from.latitude}>${to.longitude},${to.latitude}`;
  itinerary.forEach((stops, day) => {
    if (days && !days.has(day + 1)) return;
    for (let index = 1; index < stops.length; index++) {
      const from = stops[index - 1][4];
      const to = stops[index][4];
      if (!stops[index][5] && hasCoordinates(from) && hasCoordinates(to) &&
          (from.longitude !== to.longitude || from.latitude !== to.latitude)) {
        pairs.set(keyOf(from, to), [from, to]);
      }
    }
  });
  const results = new Map();
  const candidates = [...pairs].slice(0, 8);
  const signal = AbortSignal.timeout(6500);
  await Promise.all(candidates.map(async ([key, [from, to]]) => {
    try {
      const result = await get_routes(from, to, signal);
      if (result.status === 'available') results.set(key, result);
    } catch {
      // Leave the segment unconfirmed if a route does not arrive in time.
    }
  }));
  if (candidates.length) trace.push({
    name: 'get_routes',
    summary: `좌표가 확인된 자동차 구간 추가 조회 · ${results.size}/${candidates.length}개 확인`
  });
  return itinerary.map((stops, day) => days && !days.has(day + 1) ? stops : stops.map((stop, index) => {
    const from = stops[index - 1]?.[4];
    const to = stop[4];
    const route = !stop[5] && hasCoordinates(from) && hasCoordinates(to) && results.get(keyOf(from, to));
    return route ? stop.map((value, slot) => slot === 5 ? route : value) : stop;
  }));
}
