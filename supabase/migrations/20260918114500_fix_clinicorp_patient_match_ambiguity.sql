-- Avoid collision between RETURNS TABLE output names and patient_units columns.

create or replace function private.match_or_create_clinicorp_patient(
  p_unit_id bigint,
  p_external_patient_id text,
  p_patient_name text,
  p_cpf text
)
returns table(patient_unit_id bigint, patient_id bigint)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_patient_id bigint;
  v_patient_unit_id bigint;
  v_matches integer;
  v_name text := coalesce(nullif(btrim(p_patient_name),''), concat('Paciente Clinicorp ', coalesce(nullif(btrim(p_external_patient_id),''),'sem identificação')));
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g'),'');
begin
  if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then v_cpf := null; end if;

  if nullif(btrim(p_external_patient_id),'') is not null then
    select pu.id,pu.patient_id into v_patient_unit_id,v_patient_id
    from public.patient_units pu
    where pu.unit_id=p_unit_id and pu.clinicorp_patient_id=btrim(p_external_patient_id)
    limit 1;
  end if;

  if v_patient_id is null and v_cpf is not null then
    select p.id,pu.id into v_patient_id,v_patient_unit_id
    from public.patients p
    left join public.patient_units pu on pu.patient_id=p.id and pu.unit_id=p_unit_id
    where p.cpf=v_cpf and p.archived_at is null
    order by p.updated_at desc,p.id desc limit 1;
  end if;

  if v_patient_id is null and length(btrim(v_name))>=2 then
    select count(*),min(p.id),min(pu.id) into v_matches,v_patient_id,v_patient_unit_id
    from public.patients p
    join public.patient_units pu on pu.patient_id=p.id
    where pu.unit_id=p_unit_id and pu.is_active and p.archived_at is null
      and private.normalize_match_text(p.full_name)=private.normalize_match_text(v_name);
    if v_matches<>1 then v_patient_id:=null; v_patient_unit_id:=null; end if;
  end if;

  if v_patient_id is null then
    insert into public.patients(full_name,cpf,tax_receipt_ir,status,source,notes)
    values(v_name,v_cpf,false,case when v_cpf is null then 'manual_review' else 'active' end,'clinicorp','Criado automaticamente pela sincronização do Clinicorp.')
    returning id into v_patient_id;
  else
    update public.patients p set
      full_name=case when p.full_name like 'Paciente Clinicorp %' then v_name else p.full_name end,
      cpf=coalesce(p.cpf,v_cpf),
      archived_at=null,
      updated_at=now()
    where p.id=v_patient_id;
  end if;

  if v_patient_unit_id is null then
    insert into public.patient_units(patient_id,unit_id,clinicorp_patient_id,is_active,source,metadata)
    values(
      v_patient_id,p_unit_id,
      case when nullif(btrim(p_external_patient_id),'') is not null
        and not exists(select 1 from public.patient_units x where x.unit_id=p_unit_id and x.clinicorp_patient_id=btrim(p_external_patient_id))
        then btrim(p_external_patient_id) else null end,
      true,'clinicorp',jsonb_build_object('clinicorp_auto_created',true,'clinicorp_last_patient_id',nullif(btrim(p_external_patient_id),''))
    )
    on conflict on constraint patient_units_patient_unit_unique do update set
      is_active=true,
      source=case when public.patient_units.source='manual' then 'manual' else 'clinicorp' end,
      metadata=coalesce(public.patient_units.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now()
    returning id into v_patient_unit_id;
  end if;

  update public.patient_units pu set
    clinicorp_patient_id=case
      when pu.clinicorp_patient_id is null
        and nullif(btrim(p_external_patient_id),'') is not null
        and not exists(select 1 from public.patient_units x where x.unit_id=p_unit_id and x.id<>pu.id and x.clinicorp_patient_id=btrim(p_external_patient_id))
      then btrim(p_external_patient_id)
      else pu.clinicorp_patient_id end,
    metadata=coalesce(pu.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('clinicorp_last_patient_id',nullif(btrim(p_external_patient_id),''),'clinicorp_linked_at',now())),
    updated_at=now()
  where pu.id=v_patient_unit_id;

  return query select v_patient_unit_id,v_patient_id;
end;
$$;

revoke all on function private.match_or_create_clinicorp_patient(bigint,text,text,text) from public,anon,authenticated;
