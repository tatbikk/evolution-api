import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { IntegrationSession } from '@prisma/client';

import { BaseChatbotController } from '../../base-chatbot.controller';
import { CodAgentBot, CodAgentDto } from '../dto/codAgent.dto';
import { isSupabaseConfigured } from '../libs/supabase.client';
import { codAgentBotRepository, codAgentSettingRepository } from '../repository/codAgent.repository';
import { CodAgentService } from '../services/codAgent.service';

export class CodAgentController extends BaseChatbotController<CodAgentBot, CodAgentDto> {
  constructor(
    private readonly codAgentService: CodAgentService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor);

    this.botRepository = codAgentBotRepository;
    this.settingsRepository = codAgentSettingRepository;
    // sessionRepository stays on Evolution's Prisma DB (set by the base class).

    if (this.integrationEnabled && !isSupabaseConfigured()) {
      this.logger.warn(
        'CodAgent is enabled but Supabase is not configured ' +
          '(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Requests will fail until it is set.',
      );
    }
  }

  public readonly logger = new Logger('CodAgentController');
  protected readonly integrationName = 'CodAgent';

  integrationEnabled = configService.get('CODAGENT').ENABLED;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  protected getFallbackBotId(): string | undefined {
    // COD Agent must only ever engage a customer inside an active order
    // session. Returning no fallback stops the base `emit` from running the
    // agent on an arbitrary inbound message when (and the `findBotTrigger`
    // override has already returned null) a fallback bot is configured.
    return undefined;
  }

  protected getFallbackFieldName(): string {
    return 'codAgentIdFallback';
  }

  protected getIntegrationType(): string {
    return 'codAgent';
  }

  protected getAdditionalBotData(data: CodAgentDto): Record<string, any> {
    return {
      systemPrompt: data.systemPrompt,
      llmProvider: data.llmProvider ?? 'openai',
      llmModel: data.llmModel,
      merchantName: data.merchantName,
    };
  }

  protected getAdditionalUpdateFields(data: CodAgentDto): Record<string, any> {
    return {
      systemPrompt: data.systemPrompt,
      llmProvider: data.llmProvider,
      llmModel: data.llmModel,
      merchantName: data.merchantName,
    };
  }

  // COD Agent has no externally-unique field (unlike n8n's webhookUrl), so the
  // trigger-based duplicate checks in the base class are sufficient.
  protected async validateNoDuplicatesOnUpdate(): Promise<void> {
    return;
  }

  /**
   * Enforce tenant isolation on fetch. The base `fetchBot` looks a bot up by
   * id alone; here we additionally verify it belongs to the calling instance
   * so one tenant cannot read another tenant's bot configuration.
   */
  public async fetchBot(instance: InstanceDto, botId: string): Promise<any> {
    const bot = await super.fetchBot(instance, botId);
    if (!bot) return null;

    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
    });

    if (!instanceRecord || bot.instanceId !== instanceRecord.id) {
      throw new BadRequestException(`${this.integrationName} not found`);
    }

    return bot;
  }

  /**
   * COD Agent is outbound-initiated: the conversation only exists because we
   * sent an order confirmation and opened a session. Unlike a normal chatbot,
   * it must never trigger on arbitrary inbound messages — so when there is no
   * existing session we return null instead of matching by trigger.
   */
  public async findBotTrigger(
    botRepository: any,
    content: string,
    instance: InstanceDto,
    session?: IntegrationSession,
  ): Promise<any> {
    if (!session) return null;
    return super.findBotTrigger(botRepository, content, instance, session);
  }

  protected async processBot(
    instance: any,
    remoteJid: string,
    bot: CodAgentBot,
    session: IntegrationSession,
    settings: any,
    content: string,
    pushName?: string,
    msg?: any,
  ): Promise<void> {
    await this.codAgentService.process(instance, remoteJid, bot, session, settings, content, pushName, msg);
  }
}
