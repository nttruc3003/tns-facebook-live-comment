export function lottoNumber(value: string): string | null {
  const trimmed = value.trim();
  return /^[0-9]{1,30}$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : null;
}

export function parseLottoNumbers(input: string): string[] | null {
  const parts = input.trim().split(/[\s,;]+/);
  const values = parts.map(lottoNumber);
  return values.some((value) => value === null) ? null : [...new Set(values as string[])];
}

export function matchesLotto(values: string[], called: readonly string[]): boolean {
  const numbers = values.map(lottoNumber);
  return (
    numbers.length === 3 &&
    new Set(numbers).size === 3 &&
    numbers.every((value) => value !== null && called.includes(value))
  );
}
