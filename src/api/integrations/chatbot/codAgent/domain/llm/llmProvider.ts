/**
 * Provider-neutral LLM abstraction for the COD agent.
 *
 * The agent talks only to this interface, so a new provider (e.g. Claude)
 * can be added by implementing `LlmProvider` without touching agent logic.
 */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

/** A tool/function call requested by the model. */
export interface LlmToolCall {
  id: string;
  name: string;
  /** Raw JSON string of the call arguments, as produced by the model. */
  argumentsJson: string;
}

/** A single message in the (provider-neutral) conversation. */
export interface LlmMessage {
  role: LlmRole;
  content?: string | null;
  /** Set on `assistant` messages that requested tool calls. */
  toolCalls?: LlmToolCall[];
  /** Set on `tool` messages — the id of the call this is a result for. */
  toolCallId?: string;
}

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  maxTokens?: number;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
