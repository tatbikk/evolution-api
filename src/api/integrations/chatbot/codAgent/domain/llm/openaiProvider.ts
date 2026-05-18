import OpenAI from 'openai';

import { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from './llmProvider';

const OPENAI_TIMEOUT_MS = 30000;
const OPENAI_MAX_RETRIES = 2;

/**
 * OpenAI implementation of {@link LlmProvider}. Translates the neutral
 * message/tool model to and from the OpenAI Chat Completions format.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const messages: any[] = [{ role: 'system', content: request.system }];
    for (const message of request.messages) {
      messages.push(this.toOpenAiMessage(message));
    }

    const tools = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));

    const completion = await this.client.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens,
      messages,
      tools: tools.length ? (tools as any) : undefined,
    });

    const choice = completion.choices?.[0]?.message;
    const toolCalls = (choice?.tool_calls || []).map((call: any) => ({
      id: call.id,
      name: call.function?.name,
      argumentsJson: call.function?.arguments || '{}',
    }));

    return { content: choice?.content ?? null, toolCalls };
  }

  private toOpenAiMessage(message: LlmMessage): any {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      };
    }

    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content ?? '' };
    }

    return { role: message.role, content: message.content ?? '' };
  }
}
