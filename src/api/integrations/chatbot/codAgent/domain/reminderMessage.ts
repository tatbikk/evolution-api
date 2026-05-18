/**
 * Builds the templated reminder message sent by the scheduler when a
 * customer has not yet responded to an order confirmation.
 */

const DEFAULT_REMINDER_TEMPLATE =
  'Hi {customerName}, a friendly reminder about your order {orderRef} from {businessName}. ' +
  'Please reply to confirm it, or let us know if you would like to reschedule or cancel.';

export interface ReminderContext {
  template?: string | null;
  businessName?: string | null;
  customerName?: string | null;
  merchantOrderRef: string;
}

export function buildReminderMessage(ctx: ReminderContext): string {
  const values: Record<string, string> = {
    businessName: ctx.businessName || 'our store',
    customerName: ctx.customerName || 'there',
    orderRef: ctx.merchantOrderRef,
  };

  const template = ctx.template?.trim() || DEFAULT_REMINDER_TEMPLATE;
  return template
    .replace(/\{(\w+)\}/g, (_match, key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : ''))
    .trim();
}
