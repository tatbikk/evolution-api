import { CodMerchant } from '../dto/codOrder.dto';
import { SupabaseTableRepository } from './supabaseTable.repository';

/**
 * Repository for `cod_merchant` — the per-instance COD business profile.
 * Since "merchant = Evolution instance", every profile is keyed by instanceId.
 */
export class CodMerchantRepository extends SupabaseTableRepository {
  constructor() {
    super('cod_merchant');
  }

  async findByInstanceId(instanceId: string): Promise<CodMerchant | null> {
    return this.findFirst({ where: { instanceId } });
  }

  /**
   * Create the merchant profile, or update it if one already exists for the
   * instance. Uses a single atomic upsert so concurrent calls cannot race.
   */
  async upsert(instanceId: string, data: Partial<CodMerchant>): Promise<CodMerchant> {
    const payload = { ...data, instanceId };
    delete (payload as any).id;
    delete (payload as any).createdAt;

    const { data: row, error } = await this.db
      .from(this.table)
      .upsert(payload, { onConflict: 'instanceId' })
      .select()
      .single();
    if (error) this.fail('upsert', error.message);
    return row;
  }
}

export const codMerchantRepository = new CodMerchantRepository();
