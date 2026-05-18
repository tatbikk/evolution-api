import { Logger } from '@config/logger.config';
import { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '../libs/supabase.client';

/**
 * Supabase-backed repository adapters.
 *
 * These expose the small subset of the Prisma model API that
 * `BaseChatbotController` and `findBotByTrigger` rely on
 * (findFirst / findMany / findUnique / create / update / delete), so the
 * COD Agent integration can inherit Evolution's base chatbot classes
 * unchanged while physically storing its data in Supabase.
 *
 * Only the `where` shapes actually produced by the base classes are
 * supported: scalar equality, `{ in: [...] }` and `{ not: value }`.
 * All filters go through the supabase-js query builder, which sends
 * parameterized requests — no raw filter strings are ever built.
 */

type WhereInput = Record<string, any> | undefined;

interface FindArgs {
  where?: WhereInput;
  include?: Record<string, any>;
}

export class SupabaseChatbotRepository {
  protected readonly logger = new Logger('CodAgentRepository');

  constructor(protected readonly table: string) {}

  protected get db(): SupabaseClient {
    return getSupabaseClient();
  }

  /** Translate a Prisma-style `where` object into supabase-js filters. */
  protected applyWhere(query: any, where: WhereInput): any {
    if (!where) return query;

    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue;

      if (value === null) {
        query = query.is(key, null);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        if ('in' in value) {
          query = query.in(key, value.in);
        } else if ('not' in value) {
          query = value.not === null ? query.not(key, 'is', null) : query.neq(key, value.not);
        } else {
          query = query.eq(key, value);
        }
      } else {
        query = query.eq(key, value);
      }
    }

    return query;
  }

  protected fail(operation: string, message: string): never {
    const error = `[Supabase:${this.table}] ${operation} failed: ${message}`;
    this.logger.error(error);
    throw new Error(error);
  }

  /** Strip Prisma relation syntax (`Instance: { connect: { id } }`) to a plain FK. */
  protected normalize(data: Record<string, any>): Record<string, any> {
    const payload = { ...data };

    if (payload.Instance?.connect?.id) {
      payload.instanceId = payload.Instance.connect.id;
    }
    delete payload.Instance;

    // The base classes never set these; let the database own identity/timestamps.
    delete payload.id;
    delete payload.createdAt;

    return payload;
  }

  async findFirst({ where }: FindArgs = {}): Promise<any> {
    const query = this.applyWhere(this.db.from(this.table).select('*'), where).limit(1);
    const { data, error } = await query.maybeSingle();
    if (error) this.fail('findFirst', error.message);
    return data ?? null;
  }

  async findMany({ where }: FindArgs = {}): Promise<any[]> {
    const query = this.applyWhere(this.db.from(this.table).select('*'), where);
    const { data, error } = await query;
    if (error) this.fail('findMany', error.message);
    return data ?? [];
  }

  async findUnique({ where }: { where: { id: string } }): Promise<any> {
    const { data, error } = await this.db.from(this.table).select('*').eq('id', where.id).maybeSingle();
    if (error) this.fail('findUnique', error.message);
    return data ?? null;
  }

  async create({ data }: { data: Record<string, any> }): Promise<any> {
    const payload = this.normalize(data);
    payload.updatedAt = new Date().toISOString();

    const { data: row, error } = await this.db.from(this.table).insert(payload).select().single();
    if (error) this.fail('create', error.message);
    return row;
  }

  async update({ where, data }: { where: { id: string }; data: Record<string, any> }): Promise<any> {
    const payload = this.normalize(data);
    payload.updatedAt = new Date().toISOString();

    const { data: row, error } = await this.db.from(this.table).update(payload).eq('id', where.id).select().single();
    if (error) this.fail('update', error.message);
    return row;
  }

  async delete({ where }: { where: { id: string } }): Promise<any> {
    const { data: row, error } = await this.db.from(this.table).delete().eq('id', where.id).select().single();
    if (error) this.fail('delete', error.message);
    return row;
  }
}

/**
 * Settings repository. Adds support for the `include: { Fallback: true }`
 * relation used by `BaseChatbotController.fetchSettings`.
 */
export class SupabaseChatbotSettingRepository extends SupabaseChatbotRepository {
  constructor(private readonly fallbackTable: string) {
    super('cod_agent_setting');
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

export const codAgentBotRepository = new SupabaseChatbotRepository('cod_agent');
export const codAgentSettingRepository = new SupabaseChatbotSettingRepository('cod_agent');
