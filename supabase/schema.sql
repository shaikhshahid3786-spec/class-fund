-- Class Fund — Supabase schema

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  phone text,
  total_contribution numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists fund_settings (
  id int primary key default 1,
  upi_id text,
  payee_name text default 'Class Fund',
  total_collection numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into fund_settings (id) values (1) on conflict (id) do nothing;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount numeric not null check (amount > 0),
  note text,
  spent_on date not null default current_date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'shaikhshahid3786@gmail.com';
$$ language sql stable;

create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

create or replace function handle_payment_verified() returns trigger as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    new.verified_at = now();
    update profiles set total_contribution = total_contribution + new.amount where id = new.student_id;
    update fund_settings set total_collection = total_collection + new.amount, updated_at = now() where id = 1;
  end if;

  if old.status = 'verified' and new.status is distinct from 'verified' then
    update profiles set total_contribution = total_contribution - old.amount where id = old.student_id;
    update fund_settings set total_collection = total_collection - old.amount, updated_at = now() where id = 1;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_payment_status_change on payments;
create trigger on_payment_status_change
  before update on payments
  for each row execute procedure handle_payment_verified();

alter table profiles enable row level security;
alter table fund_settings enable row level security;
alter table payments enable row level security;
alter table expenses enable row level security;
alter table announcements enable row level security;

drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select
  using (auth.uid() = id or is_admin());

drop policy if exists "profiles_update" on profiles;
create policy "profiles_update" on profiles for update
  using (auth.uid() = id or is_admin());

drop policy if exists "fund_settings_select" on fund_settings;
create policy "fund_settings_select" on fund_settings for select
  using (auth.role() = 'authenticated');

drop policy if exists "fund_settings_update" on fund_settings;
create policy "fund_settings_update" on fund_settings for update
  using (is_admin());

drop policy if exists "payments_select" on payments;
create policy "payments_select" on payments for select
  using (student_id = auth.uid() or is_admin());

drop policy if exists "payments_insert" on payments;
create policy "payments_insert" on payments for insert
  with check (student_id = auth.uid());

drop policy if exists "payments_update" on payments;
create policy "payments_update" on payments for update
  using (is_admin());

drop policy if exists "expenses_select" on expenses;
create policy "expenses_select" on expenses for select
  using (auth.role() = 'authenticated');

drop policy if exists "expenses_write" on expenses;
create policy "expenses_write" on expenses for insert with check (is_admin());
drop policy if exists "expenses_update" on expenses;
create policy "expenses_update" on expenses for update using (is_admin());
drop policy if exists "expenses_delete" on expenses;
create policy "expenses_delete" on expenses for delete using (is_admin());

drop policy if exists "announcements_select" on announcements;
create policy "announcements_select" on announcements for select
  using (auth.role() = 'authenticated');

drop policy if exists "announcements_write" on announcements;
create policy "announcements_write" on announcements for insert with check (is_admin());
drop policy if exists "announcements_delete" on announcements;
create policy "announcements_delete" on announcements for delete using (is_admin());
