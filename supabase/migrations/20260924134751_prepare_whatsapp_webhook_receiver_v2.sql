
alter table public.whatsapp_webhook_events
  add column if not exists unit_id bigint references public.units(id) on delete set null,
  add column if not exists processed_at timestamptz,
  add column if not exists error_message text;

create index if not exists whatsapp_webhook_events_phone_idx
  on public.whatsapp_webhook_events(phone_number_id, received_at desc);

create index if not exists whatsapp_webhook_events_message_idx
  on public.whatsapp_webhook_events(message_id)
  where message_id is not null;

alter table public.whatsapp_webhook_events enable row level security;
revoke all on public.whatsapp_webhook_events from public, anon, authenticated;
grant select, insert, update on public.whatsapp_webhook_events to service_role;

insert into public.system_secrets(key, secret)
values ('whatsapp_webhook_verify_token', 'LYVRA_META_2026_9K7Q3P')
on conflict (key) do update
set secret = excluded.secret,
    updated_at = now();
