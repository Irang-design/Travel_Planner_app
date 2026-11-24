let mapSdk;
let fallbackSdk;
let displayedMap;
let currentMapView;
let naverUnavailable = false;

function loadFallbackSdk() {
  if (fallbackSdk) return fallbackSdk;
  fallbackSdk = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    const script = document.createElement('script');
    const root = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
    css.rel = 'stylesheet';
    css.href = root + '.css';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    script.src = root + '.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    css.crossOrigin = script.crossOrigin = 'anonymous';
    let loaded = 0;
    const timer = setTimeout(fail, 10000);
    function fail() {
      clearTimeout(timer);
      css.remove();
      script.remove();
      reject(new Error('대체 지도를 불러오지 못했습니다.'));
    }
    css.onerror = script.onerror = fail;
    css.onload = script.onload = () => {
      if (++loaded !== 2) return;
      clearTimeout(timer);
      if (window.L) resolve(window.L);
      else fail();
    };
    document.head.append(css, script);
  }).catch(error => {
    fallbackSdk = null;
    throw error;
  });
  return fallbackSdk;
}

function loadMapSdk() {
  if (mapSdk) return mapSdk;
  mapSdk = (async () => {
    const response = await fetch('/api/map-config');
    if (!response.ok) throw new Error('지도 설정을 불러오지 못했습니다.');
    const { clientId } = await response.json();
    if (!clientId) throw new Error('서버에서 NAVER 지도 Client ID를 설정해 주세요.');

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => fail('NAVER 지도 로딩 시간이 초과되었습니다.'), 12000);
      function fail(message) {
        clearTimeout(timer);
        script.remove();
        reject(new Error(message));
      }
      window.navermap_authFailure = () => {
        const message = 'NAVER 지도 인증에 실패했습니다. Web Dynamic Map 사용 설정과 등록된 웹 서비스 URL을 확인해 주세요.';
        fail(message);
        mapSdk = null;
        naverUnavailable = true;
        if (currentMapView) void drawFallback(currentMapView);
      };
      const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
      url.searchParams.set('ncpKeyId', clientId);
      url.searchParams.set('callback', 'tripMapReady');
      window.tripMapReady = () => {
        clearTimeout(timer);
        resolve(window.naver.maps);
      };
      script.onerror = () => fail('NAVER 지도를 불러오지 못했습니다.');
      script.src = url;
      document.head.append(script);
    });
  })().catch(error => {
    mapSdk = null;
    throw error;
  });
  return mapSdk;
}

function clearTripMap() {
  currentMapView = null;
  disposeMap();
}

function disposeMap() {
  displayedMap?.();
  displayedMap = null;
}

async function drawFallback(view) {
  if (view.fallbackStarted || currentMapView !== view || !view.container.isConnected) return;
  view.fallbackStarted = true;
  disposeMap();
  const { container, status, markers, routes } = view;
  container.setAttribute('aria-label', 'OpenStreetMap 방문 장소 지도');
  status.textContent = 'NAVER 지도에 연결할 수 없어 대체 지도를 불러오는 중…';
  try {
    const maps = await loadFallbackSdk();
    if (currentMapView !== view || !container.isConnected) return;
    const points = markers.map(({ place }) => [place.latitude, place.longitude]);
    const map = maps.map(container).setView(points[0], 14);
    displayedMap = () => map.remove();
    const tiles = maps.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19
    });
    const attribution = routes.length ? ' · 자동차 경로 NAVER Maps' : '';
    let receivedTile = false;
    tiles.once('tileload', () => {
      receivedTile = true;
      status.textContent = 'OpenStreetMap 대체 지도' + attribution;
    });
    tiles.on('load', () => {
      if (!receivedTile) status.textContent = '대체 지도 타일을 불러오지 못했습니다. 아래에서 방문 장소와 이동시간을 확인할 수 있어요.';
    });
    points.forEach((position, index) => maps.marker(position, { title: markers[index].title }).addTo(map));
    const bounds = maps.latLngBounds(points);
    for (const route of routes) {
      const path = route.path.map(([longitude, latitude]) => [latitude, longitude]);
      maps.polyline(path, { color: '#17654b', weight: 5, opacity: 0.85 }).addTo(map);
      bounds.extend(path);
    }
    if (points.length > 1 || routes.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    tiles.addTo(map);
  } catch {
    if (currentMapView !== view || !container.isConnected) return;
    disposeMap();
    container.hidden = true;
    status.textContent = '지도를 불러오지 못했습니다. 아래에서 방문 장소와 이동시간을 확인할 수 있어요.';
  }
}

async function drawTripMap(container, status, stops) {
  const markers = stops.flatMap(([, name, , , place], index) =>
    Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude) ? [{ place, title: `${index + 1}. ${name}` }] : []);
  if (!markers.length) {
    container.hidden = true;
    status.textContent = '이 날짜에는 좌표를 확인한 장소가 없습니다.';
    return;
  }
  const routes = stops.map(stop => stop[5]).filter(route => route?.path?.length >= 2);
  const view = { container, status, markers, routes, fallbackStarted: false };
  currentMapView = view;
  if (naverUnavailable) return drawFallback(view);
  status.textContent = 'NAVER 지도를 불러오는 중…';
  try {
    const maps = await loadMapSdk();
    if (currentMapView !== view || !container.isConnected || view.fallbackStarted) return;
    const positions = markers.map(({ place }) => new maps.LatLng(place.latitude, place.longitude));
    const map = new maps.Map(container, { center: positions[0], zoom: 14 });
    displayedMap = () => map.destroy();
    const bounds = new maps.LatLngBounds(positions[0], positions[0]);
    positions.forEach((position, index) => {
      bounds.extend(position);
      new maps.Marker({ map, position, title: markers[index].title });
    });
    let routeCount = 0;
    for (const route of routes) {
      const path = route.path.map(([longitude, latitude]) => new maps.LatLng(latitude, longitude));
      path.forEach(point => bounds.extend(point));
      new maps.Polyline({ map, path, strokeColor: '#17654b', strokeWeight: 5, strokeOpacity: 0.85 });
      routeCount++;
    }
    if (routeCount || positions.some(position => !position.equals(positions[0]))) {
      map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32, maxZoom: 16 });
    }
    status.textContent = routeCount ? `지도에 실제 자동차 경로 ${routeCount}개를 표시했습니다.` : '확인된 장소만 마커로 표시했습니다.';
  } catch {
    await drawFallback(view);
  }
}
