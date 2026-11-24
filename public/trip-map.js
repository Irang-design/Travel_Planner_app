let mapSdk;
let displayedMap;

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
        if (displayedMap) {
          displayedMap.status.textContent = message;
          clearTripMap();
        }
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
  displayedMap?.map.destroy();
  displayedMap = null;
}

async function drawTripMap(container, status, stops) {
  const markers = stops.flatMap(([, name, , , place], index) =>
    Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude) ? [{ place, title: `${index + 1}. ${name}` }] : []);
  if (!markers.length) {
    container.hidden = true;
    status.textContent = '이 날짜에는 좌표를 확인한 장소가 없습니다.';
    return;
  }
  status.textContent = 'NAVER 지도를 불러오는 중…';
  try {
    const maps = await loadMapSdk();
    if (!container.isConnected) return;
    const positions = markers.map(({ place }) => new maps.LatLng(place.latitude, place.longitude));
    const map = new maps.Map(container, { center: positions[0], zoom: 14 });
    displayedMap = { map, status };
    const bounds = new maps.LatLngBounds(positions[0], positions[0]);
    positions.forEach((position, index) => {
      bounds.extend(position);
      new maps.Marker({ map, position, title: markers[index].title });
    });
    let routeCount = 0;
    for (const [, , , , , route] of stops) {
      if (!route?.path || route.path.length < 2) continue;
      const path = route.path.map(([longitude, latitude]) => new maps.LatLng(latitude, longitude));
      path.forEach(point => bounds.extend(point));
      new maps.Polyline({ map, path, strokeColor: '#17654b', strokeWeight: 5, strokeOpacity: 0.85 });
      routeCount++;
    }
    if (routeCount || positions.some(position => !position.equals(positions[0]))) {
      map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32, maxZoom: 16 });
    }
    status.textContent = routeCount ? `지도에 실제 자동차 경로 ${routeCount}개를 표시했습니다.` : '확인된 장소만 마커로 표시했습니다.';
  } catch (error) {
    if (!container.isConnected) return;
    clearTripMap();
    container.hidden = true;
    status.textContent = error.message;
  }
}
