import { CodOrder, CreateCodOrderInput, CreateCodOrderItemInput } from '../dto/codOrder.dto';
import { SupabaseTableRepository } from './supabaseTable.repository';

/**
 * Raised when an order already exists for the same (instanceId,
 * merchantOrderRef) pair. Lets callers treat repeated creation requests
 * idempotently instead of surfacing a generic 500.
 */
export class DuplicateOrderError extends Error {
  constructor(public readonly merchantOrderRef: string) {
    super(`A COD order already exists for merchantOrderRef "${merchantOrderRef}"`);
    this.name = 'DuplicateOrderError';
  }
}

/**
 * Repository for `cod_order` (and its `cod_order_item` children).
 */
export class CodOrderRepository extends SupabaseTableRepository {
  constructor() {
    super('cod_order');
  }

  /**
   * Atomically create an order and its line items via the `create_cod_order`
   * Supabase function (single transaction). Throws {@link DuplicateOrderError}
   * if the merchant order reference is already used for this instance.
   */
  async createOrder(input: CreateCodOrderInput, items: CreateCodOrderItemInput[] = []): Promise<CodOrder> {
    const { data, error } = await this.db.rpc('create_cod_order', {
      order_data: input,
      items_data: items,
    });

    if (error) {
      // 23505 = unique_violation on ("instanceId", "merchantOrderRef").
      if (error.code === '23505') {
        throw new DuplicateOrderError(input.merchantOrderRef);
      }
      this.fail('createOrder', error.message);
    }

    return data as CodOrder;
  }

  /** Fetch a single order together with its line items. */
  async findById(id: string): Promise<CodOrder | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select('*, items:cod_order_item(*)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (this.isInvalidValueError(error)) return null;
      this.fail('findById', error.message);
    }
    return data ?? null;
  }

  /** Look an order up by its merchant-provided reference within an instance. */
  async findByMerchantRef(instanceId: string, merchantOrderRef: string): Promise<CodOrder | null> {
    return this.findFirst({ where: { instanceId, merchantOrderRef } });
  }

  /** Look an order up (with its line items) by the IntegrationSession it is bound to. */
  async findBySessionId(sessionId: string): Promise<CodOrder | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select('*, items:cod_order_item(*)')
      .eq('sessionId', sessionId)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (this.isInvalidValueError(error)) return null;
      this.fail('findBySessionId', error.message);
    }
    return data ?? null;
  }

  /** List orders for an instance, optionally filtered by status. */
  async listByInstance(instanceId: string, status?: string): Promise<CodOrder[]> {
    return this.findMany({ where: status ? { instanceId, status } : { instanceId } });
  }
}

export const codOrderRepository = new CodOrderRepository();
