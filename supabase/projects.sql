-- Building projects (e.g. new elevators): per-apartment shares, installments, project spending.
create table if not exists public.projects (
  id          bigserial primary key,
  title       text not null,
  description text,
  total_cost  numeric(12,2),            -- total project cost in AZN
  cost_note   text,                     -- e.g. '$70,000'
  status      text not null default 'active' check (status in ('planned','active','done')),
  start_date  date,
  deadline    date,
  ord         int not null default 0,
  created_at  timestamptz not null default now()
);
create table if not exists public.project_shares (
  id          bigserial primary key,
  project_id  bigint not null references public.projects(id) on delete cascade,
  apt         text not null references public.apartments(apt) on update cascade,
  grp         text,                     -- e.g. '1–6 mərtəbələr'
  share       numeric(12,2) not null default 0,   -- apartment's share of the cost
  credit      numeric(12,2) not null default 0,   -- already counted towards the share (e.g. elevator inventory)
  credit_note text,
  signed      boolean not null default false,     -- signed the protocol
  unique (project_id, apt)
);
-- committee-only details (never readable by residents)
create table if not exists public.project_share_private (
  share_id        bigint primary key references public.project_shares(id) on delete cascade,
  protocol_amount numeric(12,2),
  note            text
);
create table if not exists public.project_payments (
  id          bigserial primary key,
  share_id    bigint not null references public.project_shares(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  paid_at     date not null default current_date,
  method      text,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now()
);
create table if not exists public.project_expenses (
  id          bigserial primary key,
  project_id  bigint not null references public.projects(id) on delete cascade,
  date        date not null default current_date,
  amount      numeric(12,2) not null check (amount > 0),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists project_payments_share on public.project_payments(share_id);

alter table public.projects              enable row level security;
alter table public.project_shares        enable row level security;
alter table public.project_share_private enable row level security;
alter table public.project_payments      enable row level security;
alter table public.project_expenses      enable row level security;
do $$
declare t text;
begin
  foreach t in array array['projects','project_shares','project_payments','project_expenses'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;
drop policy if exists "admin only" on public.project_share_private;
create policy "admin only" on public.project_share_private for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke select on public.project_payments from anon;
grant select (id, share_id, amount, paid_at, method, created_at) on public.project_payments to anon;

-- Push to the apartment when a project installment is recorded
create or replace function public.push_project_payment() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text; s record; paid numeric; left_amt numeric; msg text; a text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'onesignal_rest_key' limit 1;
  if k is null then return new; end if;
  select ps.id, ps.apt, ps.share, ps.credit, p.title into s
    from public.project_shares ps join public.projects p on p.id = ps.project_id where ps.id = new.share_id;
  if s.apt is null then return new; end if;
  select coalesce(sum(amount),0) into paid from public.project_payments where share_id = s.id;
  left_amt := s.share - s.credit - paid;
  a := to_char(new.amount,'FM999990.00');
  if left_amt <= 1 then
    msg := 'Mənzil ' || s.apt || ': ' || a || ' ₼ qəbul edildi. Payınız tam ödənilib. Təşəkkür edirik! / Оплата получена, доля оплачена полностью.';
  else
    msg := 'Mənzil ' || s.apt || ': ' || a || ' ₼ qəbul edildi. Qalıq: ' || to_char(left_amt,'FM999990.00') || ' ₼ / Оплата получена, остаток ' || to_char(left_amt,'FM999990.00') || ' ₼.';
  end if;
  perform net.http_post(
    url     := 'https://api.onesignal.com/notifications?c=push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Key ' || k),
    body    := jsonb_build_object(
      'app_id', '1dfc9916-5f17-436f-9a22-66a1fdcc4652',
      'target_channel', 'push',
      'filters', jsonb_build_array(jsonb_build_object('field','tag','key','apt','relation','=','value', s.apt)),
      'headings', jsonb_build_object('en', '✅ ' || s.title || ': ödəniş qəbul edildi'),
      'contents', jsonb_build_object('en', msg),
      'url', 'https://ozlamtahirli.github.io/Akkonak-yasamal-15/#bill-' || replace(s.apt,' ','%20')
    )
  );
  return new;
exception when others then
  raise warning 'push_project_payment failed: %', sqlerrm;
  return new;
end $$;
drop trigger if exists project_payments_push on public.project_payments;
create trigger project_payments_push after insert on public.project_payments
  for each row execute function public.push_project_payment();
