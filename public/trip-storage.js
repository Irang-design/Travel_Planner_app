const tripStorage = (() => {
  const key = 'eodiro.saved-trips.v1';
  const redact = (value, max = 500) => String(value ?? '').slice(0, max)
    .replace(/\b(?:sk-(?:proj-)?[\w-]{12,}|gh[pousr]_[\w-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[가림]')
    .replace(/\b(?:Bearer\s+[^\s,]+|(?:[\w-]*(?:key|secret|token|password))\s*[:=]\s*[^\s,;]+)/gi, '[가림]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[가림]')
    .replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, '[가림]');
  const urls = values => [...new Set((values ?? []).map(publicUrl).filter(Boolean))];

  function publicUrl(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
          /sk-|token|secret|password/i.test(decodeURIComponent(url.pathname))) return null;
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  const point = place => place && ({
    name: redact(place.name), address: redact(place.address), category: redact(place.category),
    longitude: Number.isFinite(place.longitude) ? place.longitude : null,
    latitude: Number.isFinite(place.latitude) ? place.latitude : null,
    sourceUrl: publicUrl(place.sourceUrl)
  });
  const issue = entry => ({ message: redact(entry.message), day: entry.day, severity: entry.severity });

  function snapshot(plan) {
    const itinerary = plan.itinerary.map(day => day.map(([time, name, category, detail, place, route, visit]) => [
      time, redact(name), redact(category), redact(detail), point(place),
      route ? {
        durationMinutes: route.durationMinutes, durationMs: route.durationMs, distanceKm: route.distanceKm,
        path: (route.path ?? []).filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite))
      } : null,
      visit ? {
        endTime: visit.endTime, setting: visit.setting,
        hours: visit.hours && publicUrl(visit.hours.sourceUrl) ? {
          date: visit.hours.date, sourceUrl: publicUrl(visit.hours.sourceUrl),
          windows: visit.hours.windows.map(({ opens, closes }) => ({ opens, closes }))
        } : null
      } : null
    ]));
    return {
      region: plan.region, start: plan.start, days: plan.days, people: plan.people, budget: plan.budget,
      transport: plan.transport, chosen: plan.chosen.map(value => redact(value, 50)),
      maxStops: plan.maxStops, maxTravelMinutes: plan.maxTravelMinutes,
      itinerary, costs: plan.costs.map(([label, amount, status]) => [redact(label), amount, status]),
      weather: plan.weather?.map(day => ({
        date: day.date, status: day.status, reason: redact(day.reason),
        source: publicUrl(day.source), rainExpected: day.rainExpected, maxRainProbability: day.maxRainProbability,
        forecastType: redact(day.forecastType, 10), forecastArea: redact(day.forecastArea, 50)
      })) ?? null,
      trace: (plan.trace ?? []).map(entry => ({ name: redact(entry.name, 80), summary: redact(entry.summary), sources: urls(entry.sources) })),
      webSources: urls(plan.webSources ?? plan.trace?.filter(entry => entry.name === 'web_search').flatMap(entry => entry.sources ?? [])),
      validation: plan.validation ? {
        issues: plan.validation.issues.map(issue), resolved: plan.validation.resolved.map(issue),
        replans: plan.validation.replans, repairFailed: plan.validation.repairFailed,
        changes: plan.validation.changes.map(({ day, before, after }) => ({ day, before: redact(before), after: redact(after) }))
      } : null,
      locallyEdited: Boolean(plan.locallyEdited)
    };
  }

  function read() {
    const items = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(items) || items.some(item => !item?.id || !Array.isArray(item.plan?.itinerary))) {
      throw new Error('저장된 여행 계획을 읽을 수 없습니다.');
    }
    return items;
  }

  function write(items) {
    localStorage.setItem(key, JSON.stringify(items));
  }

  function save(title, plan, id) {
    const items = read();
    const entry = { id: id ?? crypto.randomUUID(), title: redact(title, 80).trim(), updatedAt: new Date().toISOString(), plan: snapshot(plan) };
    if (!entry.title) throw new Error('여행 계획 이름을 입력해 주세요.');
    write([entry, ...items.filter(item => item.id !== entry.id)]);
    return entry;
  }

  function remove(id) {
    write(read().filter(item => item.id !== id));
  }

  function toJson(entry) {
    return JSON.stringify({
      version: 1, title: redact(entry.title, 80), updatedAt: entry.updatedAt, plan: snapshot(entry.plan)
    }, null, 2);
  }

  return { read, save, remove, toJson };
})();
