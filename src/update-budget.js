import { calculate_budget } from './calculate-budget.js';
import { findPlan, rememberPlan } from './plan-snapshots.js';
import { validateItinerary } from './validate-itinerary.js';

const validAmount = amount => Number.isInteger(amount) && amount >= 0 && amount <= 100000000;

export function updateBudget(request, response) {
  const { planId, budget, amounts } = request.body ?? {};
  const plan = findPlan(planId);
  if (!plan) return response.status(404).json({ error: '현재 일정의 세션이 만료됐습니다. 일정을 다시 만들어 주세요.' });
  if (!validAmount(budget) || budget < 1 || !Array.isArray(amounts) || amounts.length !== plan.costs.length ||
      !amounts.every(amount => amount === null || validAmount(amount))) {
    return response.status(400).json({ error: '총예산과 항목별 금액을 원 단위 정수로 확인해 주세요.' });
  }

  const expenses = plan.costs.map((item, index) => {
    const amount = amounts[index];
    return amount === item.amount ? item : { category: item.category, amount, status: amount === null ? 'unknown' : 'estimated' };
  });
  const { items } = calculate_budget(budget, expenses);
  const conditions = { ...plan.conditions, budget };
  const issues = validateItinerary(plan.itinerary, items, plan.weather, conditions);
  return response.json({
    planId: rememberPlan({ ...plan, conditions, costs: items, issues }),
    budget,
    costs: items.map(({ category, amount, status }) => [category, amount, status]),
    issues
  });
}
