import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';

import { buildConfirmationMessage } from '../domain/confirmationMessage';
import { assertTransition } from '../domain/orderState';
import { CodOrder, CreateCodOrderDto } from '../dto/codOrder.dto';
import { codAgentBotRepository } from '../repository/codAgent.repository';
import { codMerchantRepository } from '../repository/codMerchant.repository';
import { codOrderRepository, DuplicateOrderError } from '../repository/codOrder.repository';

export interface CreateCodOrderResult {
  created: boolean;
  confirmationSent: boolean;
  order: CodOrder | null;
}

/**
 * Creates COD orders and fires the single outbound confirmation message.
 *
 * The endpoint is idempotent on (instanceId, merchantOrderRef): repeating the
 * request returns the existing order. The confirmation is (re)sent only while
 * the order is still `pending`, so a retry after a failed send works without
 * ever sending twice.
 */
export class CodOrderService {
  private readonly logger = new Logger('CodOrderService');

  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly prismaRepository: PrismaRepository,
  ) {}

  async createOrder(instance: InstanceDto, data: CreateCodOrderDto): Promise<CreateCodOrderResult> {
    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
    });
    if (!instanceRecord) {
      throw new BadRequestException('Instance not found');
    }
    const instanceId = instanceRecord.id;

    // COD is outbound-initiated: a configured, enabled COD Agent bot must
    // exist so the confirmation reply has an agent and session to bind to.
    const bot = await codAgentBotRepository.findFirst({ where: { instanceId, enabled: true } });
    if (!bot) {
      throw new BadRequestException('Configure and enable a COD Agent bot for this instance before creating orders');
    }

    const customerNumber = (data.customerNumber || '').replace(/\D/g, '');
    if (!customerNumber) {
      throw new BadRequestException('customerNumber must contain digits');
    }
    const customerJid = `${customerNumber}@s.whatsapp.net`;

    let created = true;
    let order: CodOrder;
    try {
      order = await codOrderRepository.createOrder(
        {
          instanceId,
          merchantOrderRef: data.merchantOrderRef,
          customerJid,
          customerName: data.customerName,
          customerPhone: customerNumber,
          totalAmount: data.totalAmount,
          currency: data.currency,
          deliveryAddress: data.deliveryAddress,
          deliveryDate: data.deliveryDate,
          notes: data.notes,
        },
        data.items || [],
      );
    } catch (err) {
      if (!(err instanceof DuplicateOrderError)) throw err;
      created = false;
      order = await codOrderRepository.findByMerchantRef(instanceId, data.merchantOrderRef);
      if (!order) throw err;
    }

    let confirmationSent = order.status !== 'pending';
    if (order.status === 'pending') {
      confirmationSent = await this.sendConfirmation(instance, instanceId, bot.id, order.id);
    }

    return {
      created,
      confirmationSent,
      order: await codOrderRepository.findById(order.id),
    };
  }

  /**
   * Sends the confirmation message, opens the order-confirmation session and
   * moves the order to `awaiting_customer`. Returns false (without throwing)
   * if anything fails, leaving the order `pending` so it can be retried.
   */
  private async sendConfirmation(
    instance: InstanceDto,
    instanceId: string,
    botId: string,
    orderId: string,
  ): Promise<boolean> {
    try {
      const order = await codOrderRepository.findById(orderId);
      if (!order) throw new Error('Order vanished before confirmation');

      const waInstance = this.waMonitor.waInstances[instance.instanceName];
      if (!waInstance) throw new Error('Instance is not active/connected');

      const merchant = await codMerchantRepository.findByInstanceId(instanceId);
      const message = buildConfirmationMessage({
        template: merchant?.confirmationTemplate,
        businessName: merchant?.businessName,
        customerName: order.customerName,
        merchantOrderRef: order.merchantOrderRef,
        totalAmount: order.totalAmount,
        currency: order.currency,
        deliveryAddress: order.deliveryAddress,
        items: order.items || [],
      });

      await waInstance.textMessage({ number: order.customerJid.split('@')[0], text: message, delay: 0 }, false);

      const session = await this.prismaRepository.integrationSession.create({
        data: {
          remoteJid: order.customerJid,
          pushName: order.customerName ?? null,
          sessionId: order.customerJid,
          status: 'opened',
          awaitUser: true,
          botId,
          instanceId,
          type: 'codAgent',
        },
      });

      assertTransition(order.status, 'awaiting_customer');
      await codOrderRepository.update({
        where: { id: order.id },
        data: {
          status: 'awaiting_customer',
          confirmationSentAt: new Date().toISOString(),
          sessionId: session.id,
        },
      });

      return true;
    } catch (err) {
      this.logger.error(`[CodOrder] Confirmation failed for order ${orderId}: ${err?.message || err}`);
      return false;
    }
  }
}
