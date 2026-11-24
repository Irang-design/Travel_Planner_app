const won = value => value.toLocaleString('ko-KR') + '원';

export function estimateTripBudget(costs, itinerary, { people, days, transport, request }, lodgingName, lodgingQuote) {
  const attractionCount = itinerary.flat().filter(stop => stop[2] === '관광').length;
  const mealCount = itinerary.reduce((sum, stops) => sum + Math.max(1, stops.filter(stop => stop[2] === '맛집').length), 0);
  const nights = Math.max(days - 1, 0);
  const rooms = Math.ceil(people / 2);
  const defaults = {
    식비: [people * (mealCount + days) * 15000,
      `외식 1회 ${people}인 ${won(people * 15000)} × ${mealCount}회 + 그 외 식사 ${won(people * 15000)} × ${days}일 가정`],
    숙박: [nights * rooms * 100000, nights
      ? `2인실 1박 100,000원 × ${rooms}실 × ${nights}박 가정`
      : '당일치기 · 숙박 일정 없음'],
    '체험·입장료': [attractionCount * people * 8000, attractionCount
      ? `관광 일정 1곳당 1인 8,000원 × ${attractionCount}곳 × ${people}명 가정. 무료 입장 여부는 미확인`
      : '일정에 별도 관광 항목이 없어 기본 입장료를 0원으로 계산']
  };

  if (transport === '자동차') {
    let fuel = 0;
    let toll = 0;
    let usedRouteRates = false;
    let usedAllowances = false;
    for (const stops of itinerary) {
      // A one-stop day has no internal leg; reserve an allowance for local driving.
      const legs = stops.length > 1 ? stops.slice(1).map(stop => stop[5]) : [null];
      for (const leg of legs) {
        usedRouteRates ||= leg?.fuelPrice != null || leg?.tollFare != null;
        usedAllowances ||= leg?.fuelPrice == null || leg?.tollFare == null;
        fuel += leg?.fuelPrice ?? Math.round((leg?.distanceKm ?? 15) / 12 * 1700);
        toll += leg?.tollFare ?? 3000;
      }
    }
    const basis = [usedRouteRates ? '조회된 구간은 NAVER 경로 예상 요금' : '',
      usedAllowances ? '미조회 구간은 15km·연비 12km/L·유가 1,700원/L 및 통행료 3,000원 가정' : '',
      '여행지까지 왕복·주차비 제외'].filter(Boolean).join(' · ');
    defaults.교통 = [fuel + toll, `유류비 ${won(fuel)} + 통행료 ${won(toll)} · ${basis}`];
  } else {
    defaults.교통 = transport === '도보'
      ? [0, '도보 일정 기준 · 별도 차량·대중교통 요금 제외']
      : [days * people * 8000, `현지 대중교통 1인 하루 8,000원 × ${people}명 × ${days}일 가정 · 지역 간 왕복 제외`];
  }

  return costs.map(item => {
    const estimate = defaults[item.category];
    if (!estimate || item.origin === 'manual' || (item.amount !== null && item.origin !== 'default')) return item;
    if (item.category === '숙박' && lodgingQuote?.kind === 'stay_total') {
      return { ...item, amount: lodgingQuote.amount, status: 'estimated', origin: 'web_quote',
        basis: `${lodgingName} · 검색 시점에 확인된 여행 날짜·인원 기준 총 객실 요금` };
    }
    if (item.category === '숙박' && nights && (lodgingName || /[45]\s*성급?|특급\s*호텔|럭셔리\s*호텔/.test(request ?? ''))) {
      return { category: item.category, amount: null, status: 'unknown', origin: 'default',
        basis: `${lodgingName ?? '요청한 등급의 호텔'} · 체크인·체크아웃 날짜와 인원에 맞는 총 객실 요금을 확인해 주세요.` };
    }
    const [amount, basis] = estimate;
    return { ...item, amount, status: 'estimated', origin: 'default', basis };
  });
}
