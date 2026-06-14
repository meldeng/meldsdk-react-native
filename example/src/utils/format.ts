// Trim trailing zeros so amounts read cleanly (0.00021400 -> 0.000214).
export function format(n: number): string {
  let s = n.toFixed(8);
  while (s.includes('.') && (s.endsWith('0') || s.endsWith('.')))
    s = s.slice(0, -1);
  return s;
}
