import { TriggerOperator, TriggerType } from '@prisma/client';

import { BaseChatbotDto, BaseChatbotSettingDto } from '../../base-chatbot.dto';

/**
 * Request DTO for creating/updating a COD Agent bot.
 */
export class CodAgentDto extends BaseChatbotDto {
  systemPrompt?: string;
  llmProvider?: string;
  llmModel?: string;
  merchantName?: string;
}

/**
 * Request DTO for COD Agent default settings.
 */
export class CodAgentSettingDto extends BaseChatbotSettingDto {}

/**
 * Shape of a `cod_agent` row stored in Supabase. Used as the generic
 * BotType for the base chatbot classes.
 */
export interface CodAgentBot {
  id: string;
  enabled: boolean;
  description?: string | null;
  expire?: number | null;
  keywordFinish?: string | null;
  delayMessage?: number | null;
  unknownMessage?: string | null;
  listeningFromMe?: boolean | null;
  stopBotFromMe?: boolean | null;
  keepOpen?: boolean | null;
  debounceTime?: number | null;
  ignoreJids?: string[] | null;
  splitMessages?: boolean | null;
  timePerChar?: number | null;
  triggerType?: TriggerType | null;
  triggerOperator?: TriggerOperator | null;
  triggerValue?: string | null;
  instanceId: string;
  systemPrompt?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  merchantName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Shape of a `cod_agent_setting` row stored in Supabase.
 */
export interface CodAgentSetting {
  id: string;
  expire?: number | null;
  keywordFinish?: string | null;
  delayMessage?: number | null;
  unknownMessage?: string | null;
  listeningFromMe?: boolean | null;
  stopBotFromMe?: boolean | null;
  keepOpen?: boolean | null;
  debounceTime?: number | null;
  ignoreJids?: string[] | null;
  splitMessages?: boolean | null;
  timePerChar?: number | null;
  codAgentIdFallback?: string | null;
  instanceId: string;
  createdAt?: string;
  updatedAt?: string;
}
