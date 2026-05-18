import { FindArgs, SupabaseTableRepository } from './supabaseTable.repository';

/**
 * Repositories for the COD Agent chatbot configuration tables. They expose a
 * Prisma-model-shaped API so the integration can inherit Evolution's
 * `BaseChatbotController` unchanged while storing data in Supabase.
 */

/**
 * Settings repository. Adds support for the `include: { Fallback: true }`
 * relation used by `BaseChatbotController.fetchSettings`.
 */
export class SupabaseChatbotSettingRepository extends SupabaseTableRepository {
  constructor(private readonly fallbackTable: string) {
    super('cod_agent_setting');
  }

  /** An empty fallback id means "no fallback" — store NULL (the column is a uuid FK). */
  protected normalize(data: Record<string, any>): Record<string, any> {
    const payload = super.normalize(data);
    if (payload.codAgentIdFallback === '') {
      payload.codAgentIdFallback = null;
    }
    return payload;
  }

  async findFirst({ where, include }: FindArgs = {}): Promise<any> {
    const row = await super.findFirst({ where });
    if (!row) return null;

    if (include?.Fallback && row.codAgentIdFallback) {
      const { data: fallback, error } = await this.db
        .from(this.fallbackTable)
        .select('*')
        .eq('id', row.codAgentIdFallback)
        .maybeSingle();
      if (error) this.fail('findFirst(Fallback)', error.message);
      row.Fallback = fallback ?? null;
    }

    return row;
  }
}

export const codAgentBotRepository = new SupabaseTableRepository('cod_agent');
export const codAgentSettingRepository = new SupabaseChatbotSettingRepository('cod_agent');
