/**
 * Builds the single outbound COD confirmation message from a fixed template.
 *
 * The conversation that follows is handled by the LLM agent; this message is
 * deterministic on purpose — predictable, cheap, and sent exactly once.
 */

const DEFAULT_CONFIRMATION_TEMPLATE = [
  'Hello {customerName}, this is {businessName}.',
  'We received your cash-on-delivery order {orderRef}.',
  '{itemsList}',
  'Total due on delivery: {total}',
  'Delivery address: {address}',
  '',
  'Please reply to confirm this order, or let us know if you would like to reschedule or cancel it.',
].join('\n');

export interface ConfirmationContext {
  template?: string | null;
  businessName?: string | null;
  customerName?: string | null;
  merchantOrderRef: string;
  totalAmount?: number | null;
  currency?: string | null;
  deliveryAddress?: string | null;
  items: { productName: string; quantity?: number | null }[];
}

export function buildConfirmationMessage(ctx: ConfirmationContext): string {
  const itemsList = (ctx.items || [])
    .map((item) => `- ${item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}${item.productName}`)
    .join('\n');

  const total =
    ctx.totalAmount !== null && ctx.totalAmount !== undefined
      ? `${ctx.totalAmount}${ctx.currency ? ` ${ctx.currency}` : ''}`
      : '';

  const values: Record<string, string> = {
    businessName: ctx.businessName || 'our store',
    customerName: ctx.customerName || 'there',
    orderRef: ctx.merchantOrderRef,
    itemsList,
    total,
    address: ctx.deliveryAddress || '',
  };

  const template = ctx.template?.trim() || DEFAULT_CONFIRMATION_TEMPLATE;
  const filled = template.replace(/\{(\w+)\}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '',
  );

  // Collapse blank lines left behind by missing placeholders.
  return filled
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n')
    .trim();
}
