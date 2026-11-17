const LIMIT = 9_000_000_000_000n;
export function paise(input: string | number): bigint {
  const text = String(input).trim();
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(text))
    throw new Error('Enter a non-negative INR amount with at most two decimal places.');
  const [whole, decimal = ''] = text.split('.');
  const value = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (value > LIMIT) throw new Error('Amount exceeds the supported limit.');
  return value;
}
export function allocate(
  total: bigint,
  items: { id: string; weight: bigint }[],
): { id: string; amount: bigint }[] {
  if (total < 0n || !items.length || items.some((i) => i.weight < 0n))
    throw new Error('Invalid allocation.');
  const weight = items.reduce((sum, i) => sum + i.weight, 0n);
  if (weight === 0n) throw new Error('Service line items must have a positive total.');
  const allocations = items.map((i, index) => ({
    id: i.id,
    amount: (total * i.weight) / weight,
    remainder: (total * i.weight) % weight,
    index,
  }));
  let left = total - allocations.reduce((sum, i) => sum + i.amount, 0n);
  for (const item of [...allocations].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (left-- > 0n) item.amount++;
  }
  return allocations.map(({ id, amount }) => ({ id, amount }));
}
export function lineTotal(quantity: number, rate: string): bigint {
  return paise(rate) * BigInt(quantity);
}
export function invoiceTotal(
  items: { quantity: number; rate: string }[],
  discount: string,
  taxBps: number,
): { subtotal: bigint; discount: bigint; tax: bigint; total: bigint } {
  const subtotal = items.reduce((s, i) => s + lineTotal(i.quantity, i.rate), 0n),
    d = paise(discount);
  if (d > subtotal) throw new Error('Discount cannot exceed the subtotal.');
  const tax = ((subtotal - d) * BigInt(taxBps) + 5000n) / 10000n;
  return { subtotal, discount: d, tax, total: subtotal - d + tax };
}
