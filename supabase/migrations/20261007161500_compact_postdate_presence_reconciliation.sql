create or replace function public.reconcile_clinicorp_postdate_day(
  p_unit_id bigint,
  p_post_date date,
  p_rows jsonb
)
returns table(
  local_active_before integer,
  returned_rows integer,
  live_open_rows integer,
  terminal_rows integer,
  missing_rows integer
)
language plpgsql
security definer
set search_path=''
set statement_timeout='10s'
as $function$
declare
  v_item jsonb;
  v_id text;
  v_present boolean;
  v_paid boolean;
  v_cancelled boolean;
  v_method text;
  v_installment_id bigint;
  v_metadata jsonb;
  v_absence_count integer;
  v_checked integer:=0;
  v_returned integer:=0;
  v_live integer:=0;
  v_terminal integer:=0;
  v_missing integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception using errcode='42501', message='Esta rotina é exclusiva da integração segura do LYVRA.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023', message='A reconciliação precisa receber uma lista JSON.';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    v_id:=nullif(btrim(coalesce(v_item->>'id','')),'');
    if v_id is null then continue; end if;

    select i.id,i.metadata
      into v_installment_id,v_metadata
    from public.collection_cases cc
    join public.installments i on i.id=cc.installment_id and i.unit_id=cc.unit_id
    join public.payment_plans pp on pp.id=i.payment_plan_id and pp.unit_id=i.unit_id
    join public.clinicorp_payment_snapshot cps
      on cps.unit_id=i.unit_id
     and cps.clinicorp_payment_id=i.clinicorp_installment_id
    where cc.unit_id=p_unit_id
      and cc.status not in ('paid','closed')
      and i.source='clinicorp'
      and i.clinicorp_source_state='open'
      and i.status not in ('paid','cancelled','refunded')
      and pp.source='clinicorp'
      and pp.payment_method='boleto'
      and pp.archived_at is null
      and pp.status='active'
      and i.clinicorp_installment_id=v_id
      and substring(coalesce(cps.raw->>'PostDate','') from 1 for 10)=p_post_date::text
    limit 1;

    if v_installment_id is null then continue; end if;
    v_checked:=v_checked+1;
    v_present:=coalesce((v_item->>'present')::boolean,false);

    if v_present then
      v_returned:=v_returned+1;
      v_paid:=coalesce((v_item->>'paid')::boolean,false);
      v_cancelled:=coalesce((v_item->>'cancelled')::boolean,false);
      v_method:=private.normalize_match_text(coalesce(v_item->>'payment_form',''));

      update public.clinicorp_payment_snapshot
      set source_presence='present',source_presence_checked_at=now()
      where unit_id=p_unit_id and clinicorp_payment_id=v_id;

      if v_paid then
        update public.installments
        set paid_amount=greatest(coalesce(paid_amount,0),expected_amount),
            status='paid',
            clinicorp_source_state='paid',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason',null
            ),
            updated_at=now()
        where id=v_installment_id;
        v_terminal:=v_terminal+1;
      elsif v_cancelled then
        update public.installments
        set status='cancelled',
            clinicorp_source_state='cancelled',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason',null
            ),
            updated_at=now()
        where id=v_installment_id;
        v_terminal:=v_terminal+1;
      elsif v_method not like '%boleto%' then
        update public.installments
        set clinicorp_source_state='missing',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason','payment_form_changed',
              'clinicorp_current_payment_form',coalesce(v_item->>'payment_form','')
            ),
            updated_at=now()
        where id=v_installment_id;
        v_missing:=v_missing+1;
      else
        update public.installments
        set clinicorp_source_state='open',
            last_synced_at=now(),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',0,
              'clinicorp_absence_reason',null
            ),
            updated_at=now()
        where id=v_installment_id;
        v_live:=v_live+1;
      end if;
    else
      v_absence_count:=case
        when coalesce(v_metadata->>'clinicorp_absence_count','') ~ '^[0-9]+$'
          then (v_metadata->>'clinicorp_absence_count')::integer
        else 0
      end;

      if v_absence_count>=1 then
        update public.installments
        set clinicorp_source_state='missing',
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',v_absence_count+1,
              'clinicorp_absence_reason','absent_from_exact_postdate_recheck',
              'clinicorp_absence_confirmed_at',now()
            ),
            updated_at=now()
        where id=v_installment_id;

        update public.clinicorp_payment_snapshot
        set source_presence='missing',source_presence_checked_at=now()
        where unit_id=p_unit_id and clinicorp_payment_id=v_id;
        v_missing:=v_missing+1;
      else
        update public.installments
        set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'clinicorp_postdate_checked_at',now(),
              'clinicorp_absence_count',1,
              'clinicorp_absence_reason','first_absence_from_exact_postdate_recheck'
            ),
            updated_at=now()
        where id=v_installment_id;
      end if;
    end if;

    v_installment_id:=null;
    v_metadata:=null;
  end loop;

  return query select v_checked,v_returned,v_live,v_terminal,v_missing;
end;
$function$;