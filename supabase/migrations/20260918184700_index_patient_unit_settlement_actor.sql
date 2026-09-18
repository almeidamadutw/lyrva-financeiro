create index if not exists patient_units_settled_by_idx
  on public.patient_units(settled_by)
  where settled_by is not null;
