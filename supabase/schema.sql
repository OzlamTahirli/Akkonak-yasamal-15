-- Akkonak Alert / Yasamal-15 MMMC — database schema
-- Everyone (residents) can READ; only committee members listed in `admins` can WRITE.

create table if not exists public.admins (
  email text primary key
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

create table if not exists public.apartments (
  apt       text primary key,          -- '1'..'44', '45, 46', '-1'
  ord       int  not null,
  name      text,
  kommunal  numeric(10,2) not null default 0,
  parking   boolean not null default false
);

create table if not exists public.bills (
  id         bigserial primary key,
  period     text not null,             -- '2026-10'
  apt        text not null references public.apartments(apt) on update cascade,
  kommunal   numeric(10,2) not null default 0,
  prev       numeric(12,1),
  cur        numeric(12,1),
  tariff     numeric(8,4) not null default 0.125,
  elec       numeric(10,2) not null default 0,
  parking    numeric(10,2) not null default 0,
  extra      numeric(10,2) not null default 0,
  extra_note text,
  total      numeric(10,2) generated always as (kommunal + elec + parking + extra) stored,
  due        date,
  created_at timestamptz not null default now(),
  unique (period, apt)
);

create table if not exists public.payments (
  id         bigserial primary key,
  bill_id    bigint not null references public.bills(id) on delete cascade,
  amount     numeric(10,2) not null check (amount > 0),
  paid_at    date not null default current_date,
  method     text not null default 'bank',   -- bank | cash | card
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table if not exists public.notices (
  id         bigserial primary key,
  date       date not null default current_date,
  title      text not null,
  body       text,
  push       boolean not null default true,  -- send a push notification when inserted
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id         bigserial primary key,
  date       date not null default current_date,
  type       text not null default 'expense' check (type in ('expense','income')),
  category   text,
  amount     numeric(12,2) not null check (amount > 0),
  note       text,
  created_at timestamptz not null default now()
);

-- helper: is the signed-in user a committee member?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;

-- Row level security
alter table public.admins     enable row level security;
alter table public.settings   enable row level security;
alter table public.apartments enable row level security;
alter table public.bills      enable row level security;
alter table public.payments   enable row level security;
alter table public.notices    enable row level security;
alter table public.expenses   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','apartments','bills','payments','notices','expenses'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists "admins see admins" on public.admins;
create policy "admins see admins" on public.admins for select to authenticated using (public.is_admin());

-- keep committee e-mails private: residents (anon) can read payments but not who recorded them
revoke select on public.payments from anon;
grant select (id, bill_id, amount, paid_at, method, created_at) on public.payments to anon;
