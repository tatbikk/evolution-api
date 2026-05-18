import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';

import { buildConfirmationMessage } from '../domain/confirmationMessage';
import { CodOrder, CreateCodOrderDto } from '../dto/codOrder.dto';
import { codAgentBotRepository } from '../repository/codAgent.repository';
import { codMerchantRepository } from '../repository/codMerchant.repository';
import { codOrderRepository, DuplicateOrderError } from '../repository/codOrder.repository';

export interface CreateCodOrderResult {
  created: boolean;
  confirmationSent: boolean;
  order: CodOrder | null;
}

// Anti-spam guard: max order-creation calls per instance per minute.
const ORDER_RATE_LIMIT_PER_MIN = Math.max(1, Number.parseInt(process.env.CODAGENT_ORDER_RATE_LIMIT || '', 10) || 120);

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
    private readonly cache: CacheService,
  ) {}

  private async resolveInstanceId(instance: InstanceDto): Promise<string> {
    const record = await this.prismaRepository.instance.findFirst({ where: { name: instance.instanceName } });
    if (!record) throw new BadRequestException('Instance not found');
    return record.id;
  }

  /** List orders for the calling instance, optionally filtered by status. */
  async listOrders(instance: InstanceDto, status?: string): Promise<CodOrder[]> {
    const instanceId = await this.resolveInstanceId(instance);
    return codOrderRepository.listByInstance(instanceId, status);
  }

  /** Fetch one order (with items), enforcing that it belongs to the instance. */
  async getOrder(instance: InstanceDto, orderId: string): Promise<CodOrder> {
    const instanceId = await this.resolveInstanceId(instance);
    const order = await codOrderRepository.findById(orderId);
    if (!order || order.instanceId !== instanceId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async createOrder(instance: InstanceDto, data: CreateCodOrderDto): Promise<CreateCodOrderResult> {
    const instanceId = await this.resolveInstanceId(instance);

    await this.enforceRateLimit(instanceId);

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

    if (data.deliveryDate && Number.isNaN(Date.parse(data.deliveryDate))) {
      throw new BadRequestException('deliveryDate is not a valid date');
    }

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
      // Atomically claim the confirmation: only the caller that flips
      // pending -> awaiting_customer sends, so concurrent identical requests
      // can never both message the customer.
      const claimed = await codOrderRepository.updateIfStatus(order.id, 'pending', { status: 'awaiting_customer' });
      if (!claimed) {
        confirmationSent = true; // another concurrent request is handling it
      } else {
        confirmationSent = await this.sendConfirmation(instance, instanceId, bot.id, order.id);
        if (!confirmationSent) {
          // Send failed — revert so the order can be retried later.
          await codOrderRepository.updateIfStatus(order.id, 'awaiting_customer', { status: 'pending' });
        }
      }
    }

    return {
      created,
      confirmationSent,
      order: await codOrderRepository.findById(order.id),
    };
  }

  /**
   * Per-instance fixed-window anti-spam guard. The platform sends exactly one
   * confirmation per order, so a runaway caller would otherwise turn into bulk
   * messaging. Backed by the shared cache (Redis when enabled).
   */
  private async enforceRateLimit(instanceId: string): Promise<void> {
    const bucket = Math.floor(Date.now() / 60000);
    const key = `codorder:rl:${instanceId}:${bucket}`;
    const count = Number((await this.cache.get(key)) || 0);

    if (count >= ORDER_RATE_LIMIT_PER_MIN) {
      throw new BadRequestException(
        `Order rate limit exceeded (${ORDER_RATE_LIMIT_PER_MIN}/min). Slow down and retry shortly.`,
      );
    }

    await this.cache.set(key, count + 1, 120);
  }

  /**
   * Sends the confirmation message and opens the order-confirmation session.
   * The order has already been claimed (status `awaiting_customer`) by the
   * caller. The session is created before the (irreversible) send so the
   * common failure — an offline instance — leaves no half-finished state.
   * Returns false without throwing if anything fails.
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

      await waInstance.textMessage({ number: order.customerJid.split('@')[0], text: message, delay: 0 }, false);

      await codOrderRepository.update({
        where: { id: order.id },
        data: {
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
