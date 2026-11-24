let mapSdk;
let currentMapView;

function loadMapSdk() {
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps);
  if (mapSdk) return mapSdk;
  mapSdk = (async () => {
    const response = await fetch('/api/map-config', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('NAVER 지도 설정을 불러오지 못했습니다.');
    const { clientId } = await response.json();
    if (!clientId) throw new Error('NAVER 지도 Client ID를 확인해 주세요.');

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => fail('NAVER 지도 스크립트 응답이 늦어지고 있습니다.'), 15000);
      function fail(message) {
        clearTimeout(timer);
        script.remove();
        reject(new Error(message));
      }
      function ready() {
        if (!window.naver?.maps?.Map) return;
        clearTimeout(timer);
        resolve(window.naver.maps);
      }
      const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
      url.searchParams.set('ncpKeyId', clientId);
      url.searchParams.set('callback', 'tripMapReady');
      window.tripMapReady = ready;
      script.onload = ready;
      script.onerror = () => fail('NAVER 지도 스크립트를 불러오지 못했습니다.');
      script.src = url.href;
      document.head.append(script);
    });
  })().catch(error => {
    mapSdk = null;
    throw error;
  });
  return mapSdk;
}

function clearTripMap() {
  const view = currentMapView;
  currentMapView = null;
  clearTimeout(view?.tileTimer);
  view?.map?.destroy();
}

async function drawTripMap(container, status, stops) {
  const markers = stops.flatMap(([, name, , , place], index) =>
    Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude) ? [{ place, title: `${index + 1}. ${name}` }] : []);
  if (!markers.length) {
    container.hidden = true;
    status.textContent = '이 날짜에는 좌표를 확인한 장소가 없습니다.';
    return;
  }

  const view = { container };
  currentMapView = view;
  container.hidden = false;
  status.textContent = 'NAVER 지도를 불러오는 중…';

  function showError(message, hideMap) {
    if (currentMapView !== view || !container.isConnected) return;
    if (hideMap) {
      clearTripMap();
      container.hidden = true;
    }
    status.textContent = message + ' ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'map-retry';
    retry.textContent = 'NAVER 지도 다시 시도';
    retry.addEventListener('click', () => {
      clearTripMap();
      void drawTripMap(container, status, stops);
    });
    status.append(retry);
  }

  try {
    const maps = await loadMapSdk();
    if (currentMapView !== view || !container.isConnected) return;
    window.navermap_authFailure = () => showError('NAVER 지도 인증에 실패했습니다. Web 서비스 URL과 Client ID를 확인해 주세요.', true);
    const positions = markers.map(({ place }) => new maps.LatLng(place.latitude, place.longitude));
    const routes = stops.map(stop => stop[5]).filter(route => route?.path?.length >= 2);
    const map = new maps.Map(container, { center: positions[0], zoom: 14, gl: false });
    view.map = map;
    view.tileTimer = setTimeout(() => showError('NAVER 지도 타일 응답이 늦어지고 있습니다.', false), 10000);
    maps.Event.once(map, 'tilesloaded', () => {
      if (currentMapView !== view) return;
      clearTimeout(view.tileTimer);
      status.textContent = routes.length
        ? `NAVER 지도 · 실제 자동차 경로 ${routes.length}개`
        : 'NAVER 지도 · 확인된 장소를 마커로 표시했습니다.';
    });
    const bounds = new maps.LatLngBounds(positions[0], positions[0]);
    positions.forEach((position, index) => {
      bounds.extend(position);
      new maps.Marker({ map, position, title: markers[index].title });
    });
    for (const route of routes) {
      const path = route.path.map(([longitude, latitude]) => new maps.LatLng(latitude, longitude));
      path.forEach(point => bounds.extend(point));
      new maps.Polyline({ map, path, strokeColor: '#17654b', strokeWeight: 5, strokeOpacity: 0.85 });
    }
    if (routes.length || positions.some(position => !position.equals(positions[0]))) {
      map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32, maxZoom: 16 });
    }
  } catch (error) {
    showError(error.message, true);
  }
}
