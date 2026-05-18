-- ============================================================================
-- COD Agent - Supabase schema (Phase 1)
-- ----------------------------------------------------------------------------
-- Run this once in the SQL editor of your Supabase project.
--
-- Design notes:
--  * Column identifiers are camelCase (quoted) so the Supabase-backed
--    repository adapters can pass objects straight through without mapping.
--  * `instanceId` references an Evolution instance id. Evolution instances
--    live in Evolution's own PostgreSQL database, so there is NO foreign key
--    here on purpose (cross-database reference).
--  * Row Level Security is enabled with NO policies: only the service role
--    key (used by the backend) can read/write. The anon/public keys are
--    denied by default. Never expose the service role key to clients.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- cod_agent: per-instance bot configuration (mirrors Evolution's chatbot bots)
-- ----------------------------------------------------------------------------
create table if not exists public.cod_agent (
  "id"              uuid primary key default gen_random_uuid(),
  "enabled"         boolean not null default true,
  "description"     text,
  "expire"          integer default 0,
  "keywordFinish"   text,
  "delayMessage"    integer,
  "unknownMessage"  text,
  "listeningFromMe" boolean default false,
  "stopBotFromMe"   boolean default false,
  "keepOpen"        boolean default false,
  "debounceTime"    integer,
  "ignoreJids"      jsonb default '[]'::jsonb,
  "splitMessages"   boolean default false,
  "timePerChar"     integer default 50,
  "triggerType"     text,
  "triggerOperator" text,
  "triggerValue"    text,
  "instanceId"      text not null,
  -- COD-agent specific fields
  "systemPrompt"    text,
  "llmProvider"     text not null default 'openai',
  "llmModel"        text not null default 'gpt-4o-mini',
  "merchantName"    text,
  "createdAt"       timestamptz not null default now(),
  "updatedAt"       timestamptz not null default now()
);

create index if not exists cod_agent_instance_idx on public.cod_agent ("instanceId");
create index if not exists cod_agent_trigger_idx  on public.cod_agent ("instanceId", "enabled", "triggerType");

-- ----------------------------------------------------------------------------
-- cod_agent_setting: per-instance default settings (one row per instance)
-- ----------------------------------------------------------------------------
create table if not exists public.cod_agent_setting (
  "id"                 uuid primary key default gen_random_uuid(),
  "expire"             integer default 0,
  "keywordFinish"      text,
  "delayMessage"       integer,
  "unknownMessage"     text,
  "listeningFromMe"    boolean default false,
  "stopBotFromMe"      boolean default false,
  "keepOpen"           boolean default false,
  "debounceTime"       integer,
  "ignoreJids"         jsonb default '[]'::jsonb,
  "splitMessages"      boolean default false,
  "timePerChar"        integer default 50,
  "codAgentIdFallback" uuid references public.cod_agent ("id") on delete set null,
  "instanceId"         text not null unique,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Lock down: enable RLS, add no policies -> service role only.
-- ----------------------------------------------------------------------------
alter table public.cod_agent         enable row level security;
alter table public.cod_agent_setting enable row level security;
