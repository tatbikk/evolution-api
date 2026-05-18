import { LlmProvider } from './llmProvider';
import { OpenAiLlmProvider } from './openaiProvider';

export * from './llmProvider';

/**
 * Build an LLM provider by name. Phase 1 ships OpenAI only; additional
 * providers (e.g. Claude) are added here without changing agent code.
 */
export function createLlmProvider(provider: string, apiKey: string): LlmProvider {
  switch ((provider || 'openai').toLowerCase()) {
    case 'openai':
      return new OpenAiLlmProvider(apiKey);
    default:
      throw new Error(`Unsupported LLM provider: "${provider}"`);
  }
}
