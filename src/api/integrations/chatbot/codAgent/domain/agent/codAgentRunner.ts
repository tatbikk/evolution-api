import { Logger } from '@config/logger.config';

import { CodMerchant, CodOrder } from '../../dto/codOrder.dto';
import { codOrderRepository } from '../../repository/codOrder.repository';
import { LlmMessage, LlmProvider } from '../llm/llmProvider';
import { COD_AGENT_TOOLS, executeCodTool, ToolContext } from './codTools';

const MAX_ITERATIONS = 5;
const MAX_TOKENS = 700;
const FALLBACK_REPLY = 'Sorry, I could not complete that right now. Someone will follow up with you shortly.';

const DEFAULT_AGENT_PROMPT =
  'You are a polite cash-on-delivery (COD) order confirmation assistant for an online store. ' +
  'Your job is to confirm the customer pending order, or handle a cancel / reschedule / ' +
  'delivery-detail change, always using the available tools to record what the customer decides.';

const logger = new Logger('CodAgentRunner');

export interface CodAgentRunParams {
  llm: LlmProvider;
  model: string;
  botSystemPrompt?: string | null;
  order: CodOrder;
  merchant: CodMerchant | null;
  customerMessage: string;
  /** Best-effort notification to the merchant's human contact. */
  notifyMerchant: (text: string) => Promise<void>;
}

function formatItems(order: CodOrder): string {
  if (!order.items?.length) return '  (no items listed)';
  return order.items
    .map((item) => `  - ${item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}${item.productName}`)
    .join('\n');
}

function buildSystemPrompt(params: CodAgentRunParams): string {
  const { order, merchant } = params;
  const total =
    order.totalAmount !== null && order.totalAmount !== undefined
      ? `${order.totalAmount}${order.currency ? ` ${order.currency}` : ''}`
      : 'not specified';

  return [
    params.botSystemPrompt?.trim() || DEFAULT_AGENT_PROMPT,
    '',
    `You are handling exactly ONE cash-on-delivery order for ${merchant?.businessName || 'the store'}.`,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Order details:',
    `- Reference: ${order.merchantOrderRef}`,
    `- Status: ${order.status}`,
    `- Customer: ${order.customerName || 'unknown'}`,
    '- Items:',
    formatItems(order),
    `- Total due on delivery: ${total}`,
    `- Delivery address: ${order.deliveryAddress || 'not provided'}`,
    `- Requested delivery date: ${order.deliveryDate || 'not set'}`,
    '',
    'Record the customer decision with the tools: confirm_order, cancel_order,',
    'reschedule_order (newDate must be an ISO date), update_order (delivery details only),',
    'escalate_to_human for anything you cannot resolve.',
    'Only tell the customer something is done AFTER the matching tool call returns success.',
    'If a tool returns an error, never claim success — explain briefly or escalate.',
    'Keep replies short, polite, and in the same language the customer used.',
  ].join('\n');
}

function parseArgs(json: string): Record<string, any> {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Runs the COD agent for a single inbound customer message: a bounded
 * tool-calling loop where the LLM proposes tool calls and the trusted
 * executors apply them. Returns the text reply to send to the customer.
 */
export async function runCodAgent(params: CodAgentRunParams): Promise<string> {
  const system = buildSystemPrompt(params);
  const messages: LlmMessage[] = [{ role: 'user', content: params.customerMessage }];

  const ctx: ToolContext = {
    order: params.order,
    instanceId: params.order.instanceId,
    merchant: params.merchant,
    notifyMerchant: async (text) => {
      try {
        await params.notifyMerchant(text);
      } catch (err) {
        logger.error(`[CodAgent] merchant notification failed: ${err?.message || err}`);
      }
    },
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await params.llm.complete({
      model: params.model,
      system,
      messages,
      tools: COD_AGENT_TOOLS,
      maxTokens: MAX_TOKENS,
    });

    if (!response.toolCalls.length) {
      return (response.content || '').trim() || FALLBACK_REPLY;
    }

    messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      const result = await executeCodTool(call.name, parseArgs(call.argumentsJson), ctx);
      messages.push({ role: 'tool', toolCallId: call.id, content: result });
    }

    // Tools may have changed the order — refresh so the next turn sees it.
    const refreshed = await codOrderRepository.findById(ctx.order.id);
    if (refreshed) ctx.order = refreshed;
  }

  logger.warn(`[CodAgent] hit max iterations for order ${params.order.id}`);
  return FALLBACK_REPLY;
}
