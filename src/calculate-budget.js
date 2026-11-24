const validAmount = value => Number.isSafeInteger(value) && value >= 0;

export function calculate_budget(totalBudget, expenses) {
  if (!validAmount(totalBudget)) throw new TypeError('총예산은 0 이상의 정수 원화로 입력해 주세요.');
  if (!Array.isArray(expenses)) throw new TypeError('비용 항목을 배열로 입력해 주세요.');

  let confirmedTotal = 0;
  let estimatedTotal = 0;
  let unknownCount = 0;
  const items = expenses.map(item => {
    const { category, amount, status } = item ?? {};
    if (typeof category !== 'string' || !category.trim()) throw new TypeError('비용 항목 이름을 입력해 주세요.');
    if (status === 'unknown' && amount == null) {
      unknownCount++;
      return { category: category.trim(), amount: null, status };
    }
    if (!['confirmed', 'estimated'].includes(status) || !validAmount(amount)) {
      throw new TypeError('비용의 금액과 확인 상태를 확인해 주세요.');
    }
    if (status === 'confirmed') confirmedTotal += amount;
    else estimatedTotal += amount;
    return { category: category.trim(), amount, status };
  });

  const subtotal = confirmedTotal + estimatedTotal;
  if (!validAmount(subtotal)) throw new RangeError('비용 합계가 안전하게 계산할 수 있는 범위를 초과했습니다.');
  return {
    totalBudget,
    items,
    confirmedTotal,
    estimatedTotal,
    unknownCount,
    subtotal,
    remaining: totalBudget - subtotal,
    status: unknownCount ? 'partial' : estimatedTotal || items.some(item => item.status === 'estimated') ? 'estimated' : 'confirmed'
  };
}
