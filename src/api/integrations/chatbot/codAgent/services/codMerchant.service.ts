import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException } from '@exceptions';

import { CodMerchant, CodMerchantDto } from '../dto/codOrder.dto';
import { codMerchantRepository } from '../repository/codMerchant.repository';

const DEFAULT_REMINDER_INTERVAL_MIN = 360;
const DEFAULT_MAX_REMINDERS = 2;
const DEFAULT_NO_RESPONSE_AFTER_MIN = 1440;

/**
 * Reads and updates the per-instance COD merchant profile (business name,
 * escalation contact, message templates and reminder timing).
 */
export class CodMerchantService {
  constructor(private readonly prismaRepository: PrismaRepository) {}

  private async resolveInstanceId(instanceName: string): Promise<string> {
    const record = await this.prismaRepository.instance.findFirst({ where: { name: instanceName } });
    if (!record) throw new BadRequestException('Instance not found');
    return record.id;
  }

  /** Returns the stored profile, or the effective defaults if none exists yet. */
  async getMerchant(instance: InstanceDto): Promise<CodMerchant | Record<string, any>> {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    const merchant = await codMerchantRepository.findByInstanceId(instanceId);
    if (merchant) return merchant;

    return {
      instanceId,
      businessName: null,
      escalationJid: null,
      confirmationTemplate: null,
      reminderTemplate: null,
      reminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MIN,
      maxReminders: DEFAULT_MAX_REMINDERS,
      noResponseAfterMinutes: DEFAULT_NO_RESPONSE_AFTER_MIN,
    };
  }

  /** Partial upsert — only the fields present in the request are changed. */
  async setMerchant(instance: InstanceDto, data: CodMerchantDto): Promise<CodMerchant> {
    const instanceId = await this.resolveInstanceId(instance.instanceName);

    const patch: Record<string, any> = {};
    if (data.businessName !== undefined) patch.businessName = data.businessName.trim() || null;
    if (data.confirmationTemplate !== undefined) patch.confirmationTemplate = data.confirmationTemplate.trim() || null;
    if (data.reminderTemplate !== undefined) patch.reminderTemplate = data.reminderTemplate.trim() || null;
    if (data.reminderIntervalMinutes !== undefined) patch.reminderIntervalMinutes = data.reminderIntervalMinutes;
    if (data.maxReminders !== undefined) patch.maxReminders = data.maxReminders;
    if (data.noResponseAfterMinutes !== undefined) patch.noResponseAfterMinutes = data.noResponseAfterMinutes;
    if (data.escalationNumber !== undefined) {
      const digits = (data.escalationNumber || '').replace(/\D/g, '');
      patch.escalationJid = digits ? `${digits}@s.whatsapp.net` : null;
    }

    return codMerchantRepository.upsert(instanceId, patch);
  }
}
