// These whole-comment list forms are explicit gameshow choices, including a comma
// without spaces. Do not apply this to prose, dates, prices, phones or decimals.
export function explicitNumberList(message: string): string[] | null {
  const text = message.trim();
  if (!/^[0-9]{1,30}(?:(?:\s*(?:và|v|,|;|&)\s*|\s+)[0-9]{1,30})+$/iu.test(text)) return null;
  return text.match(/[0-9]+/g)!;
}
