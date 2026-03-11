create table if not exists public.patient_goal_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  goal numeric not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists patient_goal_history_patient_effective_idx
  on public.patient_goal_history (patient_id, effective_at desc);

alter table public.patient_goal_history enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'patient_goal_history'
      and policyname = 'Providers can read goal history for assigned patients'
  ) then
    create policy "Providers can read goal history for assigned patients"
      on public.patient_goal_history
      for select
      to public
      using (
        exists (
          select 1
          from public.provider_patients pp
          where pp.patient_id = patient_goal_history.patient_id
            and pp.provider_id = auth.uid()
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'patient_goal_history'
      and policyname = 'Providers can insert goal history for assigned patients'
  ) then
    create policy "Providers can insert goal history for assigned patients"
      on public.patient_goal_history
      for insert
      to public
      with check (
        exists (
          select 1
          from public.provider_patients pp
          where pp.patient_id = patient_goal_history.patient_id
            and pp.provider_id = auth.uid()
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'patient_goal_history'
      and policyname = 'Patients can read own goal history'
  ) then
    create policy "Patients can read own goal history"
      on public.patient_goal_history
      for select
      to public
      using (
        exists (
          select 1
          from public.patients p
          where p.id = patient_goal_history.patient_id
            and p.auth_user_id = auth.uid()
        )
      );
  end if;
end
$$;

insert into public.patient_goal_history (patient_id, goal, effective_at)
select
  p.id,
  coalesce(p.compliance_goal, 16),
  coalesce(p.brace_dispensed_at, p.created_at, now())
from public.patients p
where not exists (
  select 1
  from public.patient_goal_history gh
  where gh.patient_id = p.id
);
