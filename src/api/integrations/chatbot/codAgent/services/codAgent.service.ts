import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { ConfigService } from '@config/env.config';
import { IntegrationSession } from '@prisma/client';
import OpenAI from 'openai';

import { BaseChatbotService } from '../../base-chatbot.service';
import { CodAgentBot, CodAgentSetting } from '../dto/codAgent.dto';

const DEFAULT_SYSTEM_PROMPT =
  'You are a polite cash-on-delivery (COD) order confirmation assistant. ' +
  'Greet the customer, confirm their pending order, and ask them to reply to confirm, ' +
  'reschedule, or cancel the delivery. Keep replies short and clear.';

const DEFAULT_MODEL = 'gpt-4o-mini';

// Keep WhatsApp replies responsive and bounded.
const OPENAI_TIMEOUT_MS = 30000;
const OPENAI_MAX_RETRIES = 2;
const MAX_COMPLETION_TOKENS = 600;

// getConversationMessage() encodes non-text messages as "<type>Message|<id>...".
const UNSUPPORTED_MEDIA_REGEX =
  /^(audioMessage|imageMessage|videoMessage|documentMessage|documentWithCaptionMessage)\|/;

/**
 * COD Agent service.
 *
 * Phase 1: a scaffold that forwards the customer text message to OpenAI with
 * the bot's configured system prompt and replies over WhatsApp. The
 * tool-calling agent (confirm_order, cancel_order, ...) and the LLM provider
 * abstraction are added in a later phase.
 */
export class CodAgentService extends BaseChatbotService<CodAgentBot, CodAgentSetting> {
  constructor(waMonitor: WAMonitoringService, prismaRepository: PrismaRepository, configService: ConfigService) {
    super(waMonitor, prismaRepository, 'CodAgentService', configService);
  }

  protected getBotType(): string {
    return 'codAgent';
  }

  /** Resolve the OpenAI key from the environment — never persisted in Supabase. */
  private getOpenaiApiKey(): string | null {
    return process.env.CODAGENT_OPENAI_API_KEY || process.env.OPENAI_API_KEY_GLOBAL || null;
  }

  protected async sendMessageToBot(
    instance: any,
    session: IntegrationSession,
    settings: CodAgentSetting,
    bot: CodAgentBot,
    remoteJid: string,
    pushName: string,
    content: string,
  ): Promise<void> {
    try {
      if (!session) {
        this.logger.error('[CodAgent] Session is null in sendMessageToBot');
        return;
      }

      if (!content || !content.trim()) {
        this.logger.debug('[CodAgent] Empty message content, skipping');
        return;
      }

      // Phase 1 handles text only. Audio transcription / vision come later;
      // until then non-text messages get a graceful reply instead of being
      // forwarded verbatim to the model.
      if (UNSUPPORTED_MEDIA_REGEX.test(content.trim())) {
        this.logger.debug('[CodAgent] Non-text message received, replying with unknownMessage');
        await this.sendUnknownMessage(instance, remoteJid, settings);
        return;
      }

      const provider = (bot.llmProvider || 'openai').toLowerCase();
      if (provider !== 'openai') {
        this.logger.error(`[CodAgent] Unsupported llmProvider "${provider}" — only "openai" is supported in phase 1`);
        await this.sendUnknownMessage(instance, remoteJid, settings);
        return;
      }

      const apiKey = this.getOpenaiApiKey();
      if (!apiKey) {
        this.logger.error('[CodAgent] OpenAI API key is not configured (CODAGENT_OPENAI_API_KEY)');
        return;
      }

      const openai = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES });
      const systemPrompt = bot.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

      const completion = await openai.chat.completions.create({
        model: bot.llmModel?.trim() || DEFAULT_MODEL,
        max_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: pushName ? `[${pushName}] ${content}` : content },
        ],
      });

      const answer = completion.choices?.[0]?.message?.content?.trim();

      if (!answer) {
        this.logger.warn('[CodAgent] OpenAI returned an empty response');
        await this.sendUnknownMessage(instance, remoteJid, settings);
        return;
      }

      await this.sendMessageWhatsApp(instance, remoteJid, answer, settings, false);

      await this.prismaRepository.integrationSession.update({
        where: { id: session.id },
        data: { status: 'opened', awaitUser: true },
      });
    } catch (error) {
      // Never log the raw error object — it may echo request headers/keys.
      const detail = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || 'unknown error';
      this.logger.error(`[CodAgent] sendMessageToBot failed: ${detail}`);
    }
  }

  private async sendUnknownMessage(instance: any, remoteJid: string, settings: CodAgentSetting): Promise<void> {
    if (settings?.unknownMessage) {
      await this.sendMessageWhatsApp(instance, remoteJid, settings.unknownMessage, settings, false);
    }
  }
}
