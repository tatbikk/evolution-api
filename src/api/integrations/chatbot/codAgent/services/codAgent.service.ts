import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { ConfigService } from '@config/env.config';
import { IntegrationSession } from '@prisma/client';

import { BaseChatbotService } from '../../base-chatbot.service';
import { runCodAgent } from '../domain/agent/codAgentRunner';
import { createLlmProvider } from '../domain/llm';
import { CodAgentBot, CodAgentSetting } from '../dto/codAgent.dto';
import { codMerchantRepository } from '../repository/codMerchant.repository';
import { codOrderRepository } from '../repository/codOrder.repository';

const DEFAULT_MODEL = 'gpt-4o-mini';

// getConversationMessage() encodes non-text messages as "<type>Message|<id>...".
const UNSUPPORTED_MEDIA_REGEX =
  /^(audioMessage|imageMessage|videoMessage|documentMessage|documentWithCaptionMessage)\|/;

/**
 * COD Agent service.
 *
 * A customer reply only reaches here when it belongs to an open
 * order-confirmation session (see CodAgentController.findBotTrigger). The
 * service loads the bound COD order and runs the tool-calling agent, which
 * records the customer decision through the trusted COD tools.
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

      const apiKey = this.getOpenaiApiKey();
      if (!apiKey) {
        this.logger.error('[CodAgent] OpenAI API key is not configured (CODAGENT_OPENAI_API_KEY)');
        return;
      }

      const order = await codOrderRepository.findBySessionId(session.id);
      if (!order) {
        this.logger.warn(`[CodAgent] No COD order is bound to session ${session.id}; ignoring message`);
        return;
      }

      // Once escalated, a human owns the conversation — the agent steps back
      // so it does not reply over the human handling the order.
      if (order.status === 'needs_human') {
        this.logger.info(`[CodAgent] Order ${order.id} is with a human; agent staying silent`);
        return;
      }

      let llm;
      try {
        llm = createLlmProvider(bot.llmProvider || 'openai', apiKey);
      } catch (err) {
        this.logger.error(`[CodAgent] ${err?.message || err}`);
        await this.sendUnknownMessage(instance, remoteJid, settings);
        return;
      }

      const merchant = await codMerchantRepository.findByInstanceId(order.instanceId);

      const reply = await runCodAgent({
        llm,
        model: bot.llmModel?.trim() || DEFAULT_MODEL,
        botSystemPrompt: bot.systemPrompt,
        order,
        merchant,
        customerMessage: pushName ? `[${pushName}] ${content}` : content,
        notifyMerchant: async (text: string) => {
          const escalationJid = merchant?.escalationJid;
          if (!escalationJid) return;
          await instance.textMessage({ number: escalationJid.split('@')[0], text, delay: 0 }, false);
        },
      });

      if (reply) {
        await this.sendMessageWhatsApp(instance, remoteJid, reply, settings, false);
      }

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
