export function normalizeRegion(value) {
  if (typeof value !== 'string') return '';
  const name = value.normalize('NFKC').trim().replace(/ +/g, ' ');
  return name.length >= 2 && name.length <= 50 && /^[\p{L}\p{N} .·()\-]+$/u.test(name) && /\p{L}/u.test(name) ? name : '';
}

export function regionPart(value) {
  const word = value.trim().split(/\s+/).at(-1) ?? '';
  const shortened = word.replace(/(?:특별자치도|특별자치시|특별시|광역시|[시군구도])$/, '');
  return shortened.length >= 2 ? shortened : word;
}

export function addressMatchesRegion(address, region) {
  const aliases = new Map([['제주', ['제주', '서귀포']], ['강원', ['강원']], ['경기', ['경기']],
    ['전북', ['전북', '전라북', '전북특별자치']], ['전남', ['전남', '전라남']],
    ['충북', ['충북', '충청북']], ['충남', ['충남', '충청남']], ['경북', ['경북', '경상북']], ['경남', ['경남', '경상남']]]);
  return region.trim().split(/\s+/).every(word => {
    const part = regionPart(word) || word;
    return (aliases.get(part) ?? [part]).some(label => address.includes(label));
  });
}
