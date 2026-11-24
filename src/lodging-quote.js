const identity = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : '';

export const lodgingQuoteSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['hotel', 'amount', 'kind', 'sourceUrl', 'evidence', 'checkIn', 'checkOut', 'guests'],
  properties: {
    hotel: { type: 'string' },
    amount: { type: 'integer' },
    kind: { type: 'string', enum: ['stay_total', 'nightly_reference'] },
    sourceUrl: { type: 'string' },
    evidence: { type: 'string' },
    checkIn: { type: ['string', 'null'] },
    checkOut: { type: ['string', 'null'] },
    guests: { type: ['integer', 'null'] }
  }
};

export function verifiedLodgingQuote(quote, hotel, conditions, sources) {
  if (!hotel || conditions.days <= 1 || !quote || identity(quote.hotel) !== identity(hotel) ||
      !Number.isSafeInteger(quote.amount) || quote.amount <= 0 || quote.amount > 100000000 ||
      !sources.has(quote.sourceUrl) || typeof quote.evidence !== 'string' || quote.evidence.length > 250) return null;
  const prices = [...quote.evidence.matchAll(/(?:₩\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*원)/g)]
    .map(match => Number((match[1] ?? match[2]).replaceAll(',', '')));
  if (!prices.includes(quote.amount)) return null;
  if (quote.kind === 'stay_total') {
    const checkOut = new Date(Date.parse(conditions.start) + (conditions.days - 1) * 86400000).toISOString().slice(0, 10);
    if (quote.checkIn !== conditions.start || quote.checkOut !== checkOut || quote.guests !== conditions.people) return null;
    // Dates and occupancy must be visible in the source evidence as well as in structured fields.
    if (![quote.checkIn, quote.checkOut].every(date => {
      const [year, month, day] = date.split('-');
      return quote.evidence.includes(date) || quote.evidence.includes(`${Number(month)}월 ${Number(day)}일`) ||
        quote.evidence.includes(`${year}.${month}.${day}`);
    }) || !new RegExp(`(?:^|\\D)${quote.guests}\\s*(?:명|인)`).test(quote.evidence)) return null;
  } else if (quote.kind !== 'nightly_reference' || !/1\s*박|박당|1\s*night|per night/i.test(quote.evidence)) return null;
  return quote;
}
