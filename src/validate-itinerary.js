const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function validateItinerary(itinerary, costs, weather, conditions) {
  const issues = [];
  const add = (code, message, day = null, severity = 'conflict', subject = '') =>
    issues.push({ id: JSON.stringify([code, day, subject]), code, message, day, severity, subject });
  const total = costs.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  if (total > conditions.budget) add('budget', `반영된 비용이 총예산을 ${(total - conditions.budget).toLocaleString('ko-KR')}원 초과합니다.`);
  if (costs.some(item => item.amount === null)) add('budget_unknown', '미확인 비용이 있어 최종 지출과 잔여 예산을 확인해야 합니다.', null, 'unknown');

  itinerary.forEach((stops, index) => {
    const day = index + 1;
    const date = new Date(Date.parse(conditions.start) + index * 86400000).toISOString().slice(0, 10);
    const forecast = weather?.find(item => item.date === date);
    const limit = conditions.maxTravelMinutes ?? 90;
    if (stops.length > conditions.maxStops) add('stops', `방문 장소 ${stops.length}곳이 하루 상한 ${conditions.maxStops}곳을 초과합니다.`, day);
    let latestEnd = -1;
    let lastStart = -1;
    for (const [i, [time, name, , , , route, visit]] of stops.entries()) {
      const place = `${time} ${name}`;
      const start = minute(time);
      const end = visit.endTime ? minute(visit.endTime) : start;
      if (start === lastStart || start < latestEnd || end < start) {
        add('overlap', `${place} 일정이 앞 일정과 겹치거나 종료 시간이 올바르지 않습니다.`, day, 'conflict', name);
      }
      latestEnd = Math.max(latestEnd, end);
      lastStart = start;
      if (i && conditions.transport === '자동차') {
        if (!route) add('route_unknown', `${name}까지 자동차 이동시간 확인 필요.`, day, 'unknown', name);
        else if (route.durationMs > limit * 60000) add('route', `${name}까지 약 ${route.durationMinutes}분으로 구간 기준 ${limit}분을 초과합니다.`, day, 'conflict', name);
      }
      if (!visit.hours) {
        add('hours_unknown', `${name}의 방문일 영업시간 확인 필요.`, day, 'unknown', name);
      } else if (!visit.hours.windows.some(({ opens, closes }) => {
        const close = closes === '24:00' ? 1440 : minute(closes);
        return start >= minute(opens) && start < close && end <= close;
      })) {
        add('hours', `${place} 방문이 출처에 기재된 운영시간과 맞지 않습니다.`, day, 'conflict', name);
      }
      if (visit.setting === 'outdoor' && forecast?.status === 'forecast' && forecast.rainExpected) {
        add('weather', `${place} 야외 방문에 비가 예상됩니다.`, day, 'conflict', name);
      } else if ((visit.setting === 'outdoor' || visit.setting === 'unknown') && forecast?.status !== 'forecast') {
        add('weather_unknown', `${name}의 날씨 적합성 확인 필요.`, day, 'unknown', name);
      } else if (visit.setting === 'unknown' && forecast?.rainExpected) {
        add('setting_unknown', `${name}의 실내·야외 여부 확인 필요.`, day, 'unknown', name);
      }
    }
  });
  return issues;
}

export function checkVisit(stop, date, sources) {
  const { endTime, setting, hours } = stop;
  const validHours = hours?.date === date && sources.has(hours.sourceUrl) && Array.isArray(hours.windows) &&
    hours.windows.length <= 8 && hours.windows.every(window => window && clock.test(window.opens) &&
      (clock.test(window.closes) || window.closes === '24:00') && window.opens < window.closes);
  return {
    endTime: typeof endTime === 'string' && clock.test(endTime) ? endTime : null,
    setting: ['indoor', 'outdoor'].includes(setting) ? setting : 'unknown',
    hours: validHours ? hours : null
  };
}
