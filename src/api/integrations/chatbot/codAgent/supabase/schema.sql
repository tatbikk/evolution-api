-- ============================================================================
-- COD Agent - Supabase schema (Phases 1-2)
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

-- ============================================================================
-- COD DOMAIN (Phase 2): merchants, orders, order items
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cod_merchant: per-instance COD business profile.
-- "Merchant = Evolution instance" — keyed by instanceId, no separate auth.
-- ----------------------------------------------------------------------------
create table if not exists public.cod_merchant (
  "id"                      uuid primary key default gen_random_uuid(),
  "instanceId"              text not null unique,
  "businessName"            text,
  "escalationJid"           text,
  -- Outbound confirmation message template. Supports {businessName},
  -- {customerName}, {orderRef}, {itemsList}, {total}, {address} placeholders.
  -- When null, a built-in default template is used.
  "confirmationTemplate"    text,
  -- Reminder message template. Supports {businessName}, {customerName},
  -- {orderRef}. When null, a built-in default template is used.
  "reminderTemplate"        text,
  "reminderIntervalMinutes" integer not null default 360,
  "maxReminders"            integer not null default 2,
  "noResponseAfterMinutes"  integer not null default 1440,
  "createdAt"               timestamptz not null default now(),
  "updatedAt"               timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- cod_order: a cash-on-delivery order awaiting customer confirmation.
-- Lifecycle (transitions enforced in code by the order state machine):
--   pending -> awaiting_customer
--           -> confirmed | rescheduled | cancelled | needs_human | no_response
-- The CHECK constraint is a DB-level safety net for the set of valid statuses.
-- ----------------------------------------------------------------------------
create table if not exists public.cod_order (
  "id"                 uuid primary key default gen_random_uuid(),
  "instanceId"         text not null,
  "merchantOrderRef"   text not null,
  "customerJid"        text not null,
  "customerName"       text,
  "customerPhone"      text,
  "status"             text not null default 'pending'
                         check ("status" in ('pending', 'awaiting_customer', 'confirmed',
                                              'rescheduled', 'cancelled', 'needs_human', 'no_response')),
  "statusReason"       text,
  "totalAmount"        numeric(12, 2),
  "currency"           text,
  "deliveryAddress"    text,
  "deliveryDate"       timestamptz,
  "notes"              text,
  "reminderCount"      integer not null default 0,
  "lastReminderAt"     timestamptz,
  "confirmationSentAt" timestamptz,
  "sessionId"          text,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now(),
  -- One COD order per merchant order reference -> idempotent order creation.
  unique ("instanceId", "merchantOrderRef")
);

create index if not exists cod_order_instance_idx        on public.cod_order ("instanceId");
create index if not exists cod_order_instance_status_idx on public.cod_order ("instanceId", "status");
create index if not exists cod_order_status_idx          on public.cod_order ("status");
create index if not exists cod_order_customer_idx        on public.cod_order ("instanceId", "customerJid");

-- ----------------------------------------------------------------------------
-- cod_order_item: line items belonging to a cod_order.
-- ----------------------------------------------------------------------------
create table if not exists public.cod_order_item (
  "id"          uuid primary key default gen_random_uuid(),
  "orderId"     uuid not null references public.cod_order ("id") on delete cascade,
  "productName" text not null,
  "quantity"    integer not null default 1 check ("quantity" > 0),
  "unitPrice"   numeric(12, 2),
  "createdAt"   timestamptz not null default now()
);

create index if not exists cod_order_item_order_idx on public.cod_order_item ("orderId");

-- ----------------------------------------------------------------------------
-- create_cod_order: atomically insert an order and its line items in a single
-- transaction. Returns the new order row as jsonb. Raises a unique_violation
-- if an order with the same ("instanceId", "merchantOrderRef") already exists.
-- ----------------------------------------------------------------------------
create or replace function public.create_cod_order(order_data jsonb, items_data jsonb)
returns jsonb as $$
declare
  new_order public.cod_order;
  item jsonb;
begin
  insert into public.cod_order (
    "instanceId", "merchantOrderRef", "customerJid", "customerName", "customerPhone",
    "totalAmount", "currency", "deliveryAddress", "deliveryDate", "notes"
  )
  values (
    order_data->>'instanceId',
    order_data->>'merchantOrderRef',
    order_data->>'customerJid',
    order_data->>'customerName',
    order_data->>'customerPhone',
    nullif(order_data->>'totalAmount', '')::numeric,
    order_data->>'currency',
    order_data->>'deliveryAddress',
    nullif(order_data->>'deliveryDate', '')::timestamptz,
    order_data->>'notes'
  )
  returning * into new_order;

  for item in select * from jsonb_array_elements(coalesce(items_data, '[]'::jsonb))
  loop
    insert into public.cod_order_item ("orderId", "productName", "quantity", "unitPrice")
    values (
      new_order."id",
      item->>'productName',
      coalesce(nullif(item->>'quantity', '')::integer, 1),
      nullif(item->>'unitPrice', '')::numeric
    );
  end loop;

  return to_jsonb(new_order);
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- Keep "updatedAt" fresh on every row update (defense for any direct writes,
-- e.g. from a future admin dashboard; the backend adapter also sets it).
-- ----------------------------------------------------------------------------
create or replace function public.cod_agent_set_updated_at()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists cod_agent_updated_at on public.cod_agent;
create trigger cod_agent_updated_at
  before update on public.cod_agent
  for each row execute function public.cod_agent_set_updated_at();

drop trigger if exists cod_agent_setting_updated_at on public.cod_agent_setting;
create trigger cod_agent_setting_updated_at
  before update on public.cod_agent_setting
  for each row execute function public.cod_agent_set_updated_at();

drop trigger if exists cod_merchant_updated_at on public.cod_merchant;
create trigger cod_merchant_updated_at
  before update on public.cod_merchant
  for each row execute function public.cod_agent_set_updated_at();

drop trigger if exists cod_order_updated_at on public.cod_order;
create trigger cod_order_updated_at
  before update on public.cod_order
  for each row execute function public.cod_agent_set_updated_at();

-- ----------------------------------------------------------------------------
-- Lock down: enable RLS, add no policies -> service role only.
-- ----------------------------------------------------------------------------
alter table public.cod_agent         enable row level security;
alter table public.cod_agent_setting enable row level security;
alter table public.cod_merchant      enable row level security;
alter table public.cod_order         enable row level security;
alter table public.cod_order_item    enable row level security;
