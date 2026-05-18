import { Logger } from '@config/logger.config';
import { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '../libs/supabase.client';

/**
 * Generic Supabase-backed table repository.
 *
 * Exposes the small subset of the Prisma model API that Evolution's base
 * chatbot classes rely on (findFirst / findMany / findUnique / create /
 * update / delete), and serves as the shared base for every COD Agent
 * repository so each table gets the same query translation and error
 * handling.
 *
 * Only the `where` shapes actually needed are supported: scalar equality,
 * `{ in: [...] }` and `{ not: value }`. All filters go through the
 * supabase-js query builder, which sends parameterized requests — no raw
 * filter strings are ever built.
 */

export type WhereInput = Record<string, any> | undefined;

export interface FindArgs {
  where?: WhereInput;
  include?: Record<string, any>;
}

export class SupabaseTableRepository {
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

    // Callers never set these; let the database own identity/creation time.
    delete payload.id;
    delete payload.createdAt;

    return payload;
  }

  /** Postgres "invalid text representation" — e.g. a malformed uuid filter. */
  protected isInvalidValueError(error: any): boolean {
    return error?.code === '22P02';
  }

  async findFirst({ where }: FindArgs = {}): Promise<any> {
    const query = this.applyWhere(this.db.from(this.table).select('*'), where).limit(1);
    const { data, error } = await query.maybeSingle();
    if (error) {
      // A malformed filter value cannot match any row — treat it as "not found".
      if (this.isInvalidValueError(error)) return null;
      this.fail('findFirst', error.message);
    }
    return data ?? null;
  }

  async findMany({ where }: FindArgs = {}): Promise<any[]> {
    const query = this.applyWhere(this.db.from(this.table).select('*'), where);
    const { data, error } = await query;
    if (error) {
      if (this.isInvalidValueError(error)) return [];
      this.fail('findMany', error.message);
    }
    return data ?? [];
  }

  async findUnique({ where }: { where: { id: string } }): Promise<any> {
    const { data, error } = await this.db.from(this.table).select('*').eq('id', where.id).maybeSingle();
    if (error) {
      if (this.isInvalidValueError(error)) return null;
      this.fail('findUnique', error.message);
    }
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
