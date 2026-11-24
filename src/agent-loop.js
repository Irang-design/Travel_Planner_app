import { agentTools, costLabels, executeTool } from './agent-tools.js';

const maxResponses = 8;
const maxFunctionCalls = 7;
const maxReplans = 2;
const replanResponses = 4;

export class AgentLimitError extends Error {}

export async function runAgent(client, options, conditions, trace, review, revision) {
  const input = [{ role: 'user', content: JSON.stringify(revision?.input ?? conditions) }];
  const state = {
    places: new Map(),
    coordinates: new Map(),
    routes: new Map(),
    weather: null,
    webSources: new Set(),
    costs: Object.values(costLabels).map(category => ({ category, amount: null, status: 'unknown' })),
    ...revision?.state
  };
  let functionCalls = 0;
  const signal = AbortSignal.timeout(120000);
  const findings = new Map();
  let replans = 0;
  let phaseEnd = maxResponses;
  let best = null;
  let original = null;
  let repairFailed = false;

  try {
    for (let round = 0; round < phaseEnd; round++) {
      const tools = round === phaseEnd - 1 ? [] : agentTools;
      const response = await client.responses.create({
        ...options,
        input,
        tools,
        parallel_tool_calls: false,
        max_tool_calls: 2,
        include: ['reasoning.encrypted_content', 'web_search_call.action.sources']
      }, { signal });
      if (response.status !== 'completed') throw new Error('Incomplete response');
      const calls = [];
      for (const item of response.output) {
        if (item.type === 'function_call') calls.push(item);
        if (item.type === 'web_search_call') {
          const sources = [...new Set((item.action?.sources ?? []).map(source => source.url)
            .filter(url => typeof url === 'string' && /^https?:\/\//i.test(url)))];
          if (item.status === 'completed') sources.forEach(url => state.webSources.add(url));
          trace.push({ name: 'web_search', summary: item.status === 'completed' ? '웹 검색 완료' : '웹 검색 결과 확인 불가', sources: sources.slice(0, 8) });
        }
      }
      if (!calls.length && response.output_text) {
        const candidate = { output: response.output_text, ...state };
        if (!review) return candidate;
        const checked = { ...review(candidate), costs: candidate.costs, weather: candidate.weather };
        original ??= checked.itinerary;
        const conflicts = checked.issues.filter(issue => issue.severity === 'conflict' &&
          (!revision || checked.changedDays.includes(issue.day) || !revision.baselineIssues.has(issue.id)));
        for (const issue of conflicts) findings.set(issue.id, issue);
        if (!best || conflicts.length < best.conflictCount ||
            (conflicts.length === best.conflictCount && checked.issues.length < best.issues.length)) {
          best = { ...checked, conflictCount: conflicts.length };
        }
        if (!conflicts.length || replans >= maxReplans) break;
        replans++;
        phaseEnd = round + 1 + replanResponses;
        functionCalls = 0;
        input.push(...response.output, {
          role: 'user',
          content: JSON.stringify({ task: '서버 검증 결과에 따라 일정을 수정한다. 기존 근거를 유지하고 필요한 도구만 선택한다. 이미 확인한 비용을 미확인으로 바꿔 초과를 숨기지 않는다.', conflicts })
        });
        continue;
      }
      if (!calls.length) throw new Error('Missing itinerary');
      if (!tools.length || functionCalls + calls.length > maxFunctionCalls) {
        repairFailed = best !== null;
        break;
      }
      functionCalls += calls.length;
      input.push(...response.output);
      for (const call of calls) {
        signal.throwIfAborted();
        let result;
        let summary;
        let sources;
        try {
          ({ result, summary, sources } = await executeTool(call.name, JSON.parse(call.arguments), conditions, state));
        } catch {
          summary = '도구 실행 실패 · 결과 확인 불가';
          result = { status: 'error', message: summary };
        }
        trace.push({ name: call.name, summary, sources });
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }
    }
  } catch (error) {
    if (!best) throw error;
    repairFailed = true;
  }
  if (best) return { ...best, original, replans, repairFailed, findings: [...findings.values()] };
  throw new AgentLimitError('Agent iteration limit reached');
}
