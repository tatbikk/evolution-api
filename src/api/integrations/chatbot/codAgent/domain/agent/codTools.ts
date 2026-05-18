import { CodMerchant, CodOrder } from '../../dto/codOrder.dto';
import { codOrderRepository } from '../../repository/codOrder.repository';
import { LlmTool } from '../llm/llmProvider';
import { assertTransition, CodOrderStatus } from '../orderState';

/**
 * COD agent tools.
 *
 * The LLM only *requests* a tool; the trusted executors here validate the
 * input, enforce the order state machine and write to the database. An
 * invalid request (e.g. an illegal transition) is turned into an error
 * string the model can read — it never crashes the agent or corrupts state.
 */

export interface ToolContext {
  order: CodOrder;
  instanceId: string;
  merchant: CodMerchant | null;
  /** Notify the merchant's human contact. Best-effort; never throws. */
  notifyMerchant: (text: string) => Promise<void>;
}

export type ToolExecutor = (args: Record<string, any>, ctx: ToolContext) => Promise<string>;

export const COD_AGENT_TOOLS: LlmTool[] = [
  {
    name: 'confirm_order',
    description: 'Record that the customer confirmed the cash-on-delivery order and agreed to receive it.',
    parameters: {
      type: 'object',
      properties: { notes: { type: 'string', description: 'Optional note about the confirmation.' } },
    },
  },
  {
    name: 'cancel_order',
    description: 'Record that the customer wants to cancel the order.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why the customer is cancelling.' } },
    },
  },
  {
    name: 'reschedule_order',
    description: 'Record a new requested delivery date for the order.',
    parameters: {
      type: 'object',
      properties: {
        newDate: { type: 'string', description: 'The new delivery date in ISO 8601 format (e.g. 2026-05-20).' },
        reason: { type: 'string', description: 'Optional reason for the reschedule.' },
      },
      required: ['newDate'],
    },
  },
  {
    name: 'update_order',
    description:
      'Correct the delivery details of the order (address, delivery notes or customer name). ' +
      'Does not change products or amounts.',
    parameters: {
      type: 'object',
      properties: {
        deliveryAddress: { type: 'string' },
        notes: { type: 'string' },
        customerName: { type: 'string' },
      },
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Hand the conversation to a human agent for anything you cannot resolve.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why human help is needed.' } },
    },
  },
];

function asTrimmedString(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function transitionTo(
  ctx: ToolContext,
  to: CodOrderStatus,
  reason: string,
  successMessage: string,
): Promise<string> {
  try {
    assertTransition(ctx.order.status, to);
  } catch (err) {
    return `Could not change the order to "${to}": ${err?.message || err}`;
  }
  const data: Record<string, any> = { status: to };
  if (reason) data.statusReason = reason;
  await codOrderRepository.update({ where: { id: ctx.order.id }, data });
  return successMessage;
}

const confirmOrder: ToolExecutor = (args, ctx) =>
  transitionTo(ctx, 'confirmed', asTrimmedString(args?.notes), 'Order confirmed successfully.');

const cancelOrder: ToolExecutor = (args, ctx) =>
  transitionTo(ctx, 'cancelled', asTrimmedString(args?.reason), 'Order cancelled successfully.');

const rescheduleOrder: ToolExecutor = async (args, ctx) => {
  const raw = asTrimmedString(args?.newDate);
  if (!raw) return 'Error: a newDate (ISO 8601) is required to reschedule.';

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return `Error: "${raw}" is not a valid date. Provide an ISO 8601 date such as 2026-05-20.`;
  }

  try {
    assertTransition(ctx.order.status, 'rescheduled');
  } catch (err) {
    return `Could not reschedule the order: ${err?.message || err}`;
  }

  const data: Record<string, any> = { status: 'rescheduled', deliveryDate: date.toISOString() };
  const reason = asTrimmedString(args?.reason);
  if (reason) data.statusReason = reason;
  await codOrderRepository.update({ where: { id: ctx.order.id }, data });
  return `Order rescheduled to ${date.toISOString()}.`;
};

const updateOrder: ToolExecutor = async (args, ctx) => {
  const data: Record<string, any> = {};
  const address = asTrimmedString(args?.deliveryAddress);
  const notes = asTrimmedString(args?.notes);
  const customerName = asTrimmedString(args?.customerName);

  if (address) data.deliveryAddress = address;
  if (notes) data.notes = notes;
  if (customerName) data.customerName = customerName;

  if (!Object.keys(data).length) {
    return 'Error: nothing to update — provide deliveryAddress, notes or customerName.';
  }

  await codOrderRepository.update({ where: { id: ctx.order.id }, data });
  return 'Order delivery details updated.';
};

const escalateToHuman: ToolExecutor = async (args, ctx) => {
  const reason = asTrimmedString(args?.reason);

  try {
    assertTransition(ctx.order.status, 'needs_human');
  } catch (err) {
    return `Could not escalate the order: ${err?.message || err}`;
  }

  const data: Record<string, any> = { status: 'needs_human' };
  if (reason) data.statusReason = reason;
  await codOrderRepository.update({ where: { id: ctx.order.id }, data });

  // Notification is best-effort — its failure must not undo the escalation.
  await ctx.notifyMerchant(
    `COD order ${ctx.order.merchantOrderRef} needs human attention.${reason ? ` Reason: ${reason}` : ''}`,
  );

  return 'The order was escalated to a human agent. Tell the customer someone will follow up shortly.';
};

const EXECUTORS: Record<string, ToolExecutor> = {
  confirm_order: confirmOrder,
  cancel_order: cancelOrder,
  reschedule_order: rescheduleOrder,
  update_order: updateOrder,
  escalate_to_human: escalateToHuman,
};

/**
 * Run a tool the model asked for. Always resolves to a result string for the
 * model — unknown tools and executor failures become readable error strings
 * rather than thrown exceptions.
 */
export async function executeCodTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<string> {
  const executor = EXECUTORS[name];
  if (!executor) return `Error: unknown tool "${name}".`;

  try {
    return await executor(args || {}, ctx);
  } catch (err) {
    return `Error while running "${name}": ${err?.message || 'unexpected failure'}`;
  }
}
