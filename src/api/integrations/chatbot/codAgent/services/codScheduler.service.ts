import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import cron from 'node-cron';

import { assertTransition } from '../domain/orderState';
import { buildReminderMessage } from '../domain/reminderMessage';
import { CodMerchant, CodOrder } from '../dto/codOrder.dto';
import { codMerchantRepository } from '../repository/codMerchant.repository';
import { codOrderRepository } from '../repository/codOrder.repository';

const DEFAULT_CRON = '*/5 * * * *';
const FALLBACK_REMINDER_INTERVAL_MIN = 360;
const FALLBACK_MAX_REMINDERS = 2;
const FALLBACK_NO_RESPONSE_MIN = 1440;

/**
 * Periodic scheduler for COD orders awaiting a customer reply.
 *
 * Each pass: sends due reminders (up to the merchant's maxReminders, one per
 * reminderIntervalMinutes) and marks orders `no_response` once the merchant's
 * noResponseAfterMinutes window elapses. All timing state lives on the order
 * row in Supabase, so the scheduler is stateless and survives restarts.
 * Status changes use a compare-and-set so a decision made by the agent in
 * the meantime is never overwritten.
 */
export class CodSchedulerService {
  private readonly logger = new Logger('CodSchedulerService');
  private task: any = null;
  private running = false;

  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly prismaRepository: PrismaRepository,
  ) {}

  start(cronExpression: string = DEFAULT_CRON): void {
    if (this.task) return;
    this.task = cron.schedule(cronExpression, () => {
      this.tick().catch((err) => this.logger.error(`tick error: ${err?.message || err}`));
    });
    this.logger.info(`COD scheduler started (${cronExpression})`);
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  /** One scheduler pass. Non-overlapping: a slow pass skips the next tick. */
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous scheduler tick still running — skipping this one');
      return;
    }
    this.running = true;
    try {
      const orders = await codOrderRepository.listByStatus('awaiting_customer');
      for (const order of orders) {
        try {
          await this.processOrder(order);
        } catch (err) {
          this.logger.error(`order ${order.id}: ${err?.message || err}`);
        }
      }
    } catch (err) {
      this.logger.error(`scheduler tick failed: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
  }

  private async processOrder(order: CodOrder): Promise<void> {
    // Nothing to schedule from until the confirmation has actually been sent.
    if (!order.confirmationSentAt) return;

    const merchant = await codMerchantRepository.findByInstanceId(order.instanceId);
    const intervalMin = merchant?.reminderIntervalMinutes ?? FALLBACK_REMINDER_INTERVAL_MIN;
    const maxReminders = merchant?.maxReminders ?? FALLBACK_MAX_REMINDERS;
    const noResponseMin = merchant?.noResponseAfterMinutes ?? FALLBACK_NO_RESPONSE_MIN;

    const now = Date.now();
    const sentAt = new Date(order.confirmationSentAt).getTime();
    const elapsedMin = (now - sentAt) / 60000;

    // Hard timeout — mark no_response.
    if (elapsedMin >= noResponseMin) {
      assertTransition(order.status, 'no_response');
      const updated = await codOrderRepository.updateIfStatus(order.id, 'awaiting_customer', {
        status: 'no_response',
      });
      if (updated) this.logger.info(`order ${order.id} marked no_response`);
      return;
    }

    // Reminder due?
    const reminderCount = order.reminderCount ?? 0;
    if (reminderCount >= maxReminders) return;

    const lastEventAt = order.lastReminderAt ? new Date(order.lastReminderAt).getTime() : sentAt;
    if ((now - lastEventAt) / 60000 < intervalMin) return;

    await this.sendReminder(order, merchant);
    const updated = await codOrderRepository.updateIfStatus(order.id, 'awaiting_customer', {
      reminderCount: reminderCount + 1,
      lastReminderAt: new Date().toISOString(),
    });
    if (updated) this.logger.info(`order ${order.id} reminder ${reminderCount + 1}/${maxReminders} sent`);
  }

  private async sendReminder(order: CodOrder, merchant: CodMerchant | null): Promise<void> {
    const instanceRecord = await this.prismaRepository.instance.findUnique({ where: { id: order.instanceId } });
    if (!instanceRecord) throw new Error(`instance ${order.instanceId} not found`);

    const waInstance = this.waMonitor.waInstances[instanceRecord.name];
    if (!waInstance) throw new Error(`instance ${instanceRecord.name} is not active`);

    const message = buildReminderMessage({
      template: merchant?.reminderTemplate,
      businessName: merchant?.businessName,
      customerName: order.customerName,
      merchantOrderRef: order.merchantOrderRef,
    });

    await waInstance.textMessage({ number: order.customerJid.split('@')[0], text: message, delay: 0 }, false);
  }
}
