
create unique index if not exists integration_connections_unit_provider_unique
  on public.integration_connections(unit_id, provider)
  where unit_id is not null;

insert into public.integration_connections(
  unit_id,
  provider,
  display_name,
  status,
  non_secret_config,
  secret_reference
)
select
  u.id,
  'whatsapp',
  case
    when u.code='sorocaba' then 'WhatsApp Business · Sorocaba'
    when u.code='salto_de_pirapora' then 'WhatsApp Business · Salto de Pirapora'
    else 'WhatsApp Business'
  end,
  'pending',
  jsonb_build_object(
    'mode','coexistence',
    'cloud_api',true,
    'phone_number_id',null,
    'waba_id',null,
    'graph_version',null,
    'template_boleto_d1','boleto_d1',
    'template_language','pt_BR',
    'configured_at',null
  ),
  case
    when u.code='sorocaba' then 'WHATSAPP_SOROCABA_ACCESS_TOKEN'
    when u.code='salto_de_pirapora' then 'WHATSAPP_SALTO_ACCESS_TOKEN'
  end
from public.units u
where u.code in ('sorocaba','salto_de_pirapora')
on conflict (unit_id, provider) where unit_id is not null
do update set
  display_name=excluded.display_name,
  non_secret_config=coalesce(public.integration_connections.non_secret_config,'{}'::jsonb)
    || jsonb_build_object(
      'mode','coexistence',
      'cloud_api',true,
      'template_boleto_d1',coalesce(public.integration_connections.non_secret_config->>'template_boleto_d1','boleto_d1'),
      'template_language',coalesce(public.integration_connections.non_secret_config->>'template_language','pt_BR')
    ),
  secret_reference=excluded.secret_reference,
  updated_at=now();
