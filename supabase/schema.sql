-- ============================================================================
-- Skagen Attendance & Task Tracker — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor).
-- Replaces the old Google Sheets + Apps Script backend.
-- ============================================================================

-- ── employees ────────────────────────────────────────────────────────────
create table if not exists employees (
  id           text primary key,
  name         text not null,
  designation  text not null default 'Team Member',
  password     text not null,
  color        text not null default '#3B82F6',
  photo_url    text default '',
  created_at   timestamptz not null default now()
);

-- ── daily_logs ───────────────────────────────────────────────────────────
create table if not exists daily_logs (
  id                      text primary key, -- `${employee_id}_${date}`
  employee_id             text not null references employees(id) on delete cascade,
  employee_name           text not null,
  date                    date not null,
  office_in               text default '',
  office_out              text default '',
  submitted               boolean not null default false,
  submitted_at            timestamptz,
  approval_status         text not null default 'pending',
  total_productive_hours  numeric not null default 0
);
create index if not exists idx_daily_logs_employee_date on daily_logs(employee_id, date);

-- ── tasks ────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id                text primary key, -- uuid, generated client-side
  daily_log_id      text not null,
  employee_id       text not null references employees(id) on delete cascade,
  employee_name     text not null,
  date              date not null,
  task_name         text not null default '',
  start_time        text default '',
  end_time          text default '',
  break_time        numeric not null default 0,
  productive_hours  numeric not null default 0,
  status            text not null default 'Briefed', -- Briefed / In Progress / Submitted / Approved / Rejected / Assigned
  notes             text default '',
  manager_note      text default '',
  is_assigned       boolean not null default false
);
create index if not exists idx_tasks_employee_date on tasks(employee_id, date);

-- ── messages (team group chat) ────────────────────────────────────────────
create table if not exists messages (
  id               text primary key, -- uuid, generated client-side
  sender_id        text not null default '', -- employee id, or 'manager'
  sender_name      text not null,
  sender_role      text not null default 'employee', -- employee / manager
  sender_color     text not null default '#3B82F6',
  body             text not null default '',
  task_id          text,          -- optional linked task (snapshot below so it survives task deletes)
  task_name        text,
  task_employee    text,
  task_date        date,
  task_status      text,
  attachment_url   text,
  attachment_name  text,
  attachment_type  text,          -- mime type
  created_at       timestamptz not null default now()
);
create index if not exists idx_messages_created on messages(created_at);

-- Realtime: push new messages to open chat windows
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null;
end $$;

-- ── manager_config ───────────────────────────────────────────────────────
create table if not exists manager_config (
  key    text primary key,
  value  text not null
);

-- ============================================================================
-- Row Level Security
-- This app has no Supabase Auth session (same trust model as the old
-- "Anyone can access" Apps Script deployment) — the anon key is used
-- directly from the browser, so policies here simply allow the anon
-- role to read/write. This matches the original app's security model;
-- it is NOT locking data down per-user. Tighten later if you add real
-- Supabase Auth.
-- ============================================================================
alter table employees enable row level security;
alter table daily_logs enable row level security;
alter table tasks enable row level security;
alter table manager_config enable row level security;
alter table messages enable row level security;

drop policy if exists "anon full access" on messages;
create policy "anon full access" on messages for all using (true) with check (true);

drop policy if exists "anon full access" on employees;
create policy "anon full access" on employees for all using (true) with check (true);

drop policy if exists "anon full access" on daily_logs;
create policy "anon full access" on daily_logs for all using (true) with check (true);

drop policy if exists "anon full access" on tasks;
create policy "anon full access" on tasks for all using (true) with check (true);

drop policy if exists "anon full access" on manager_config;
create policy "anon full access" on manager_config for all using (true) with check (true);

-- ============================================================================
-- Storage bucket for employee profile photos
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read employee photos" on storage.objects;
create policy "public read employee photos" on storage.objects
  for select using (bucket_id = 'employee-photos');

drop policy if exists "anon upload employee photos" on storage.objects;
create policy "anon upload employee photos" on storage.objects
  for insert with check (bucket_id = 'employee-photos');

drop policy if exists "anon update employee photos" on storage.objects;
create policy "anon update employee photos" on storage.objects
  for update using (bucket_id = 'employee-photos');

-- ── Storage bucket for chat attachments ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

drop policy if exists "public read chat files" on storage.objects;
create policy "public read chat files" on storage.objects
  for select using (bucket_id = 'chat-files');

drop policy if exists "anon upload chat files" on storage.objects;
create policy "anon upload chat files" on storage.objects
  for insert with check (bucket_id = 'chat-files');

-- ============================================================================
-- Seed data — current live roster (as of the Google Sheets historical import)
-- Note: Huraira's (id 6) profile photo lives in the employee-photos storage
-- bucket, not seeded here — photo_url is set separately after upload.
-- ============================================================================
insert into employees (id, name, designation, password, color) values
  ('1',  'Farukh',              'Graphic Designer',         'farukh123',   '#3B82F6'),
  ('3',  'Ali Hasan',           'Video Editor',              'ali123',      '#F59E0B'),
  ('4',  'Suneel',              'Video Editor',              'suneel123',   '#EF4444'),
  ('5',  'Uman',                'Managing Partner',          'usman123',    '#8B5CF6'),
  ('6',  'Huraira',             'CEO',                       'huraira123',  '#3B82F6'),
  ('8',  'Daniyal',             'Junior Graphic Designer',   'daniyal123',  '#F59E0B'),
  ('9',  'Muhammad Abdullah',   'HR Manager',                'adii786#',    '#000000'),
  ('10', 'Syed Hassan Naqvi',   'Video Editor',               'hassan@2025', '#3B82F6'),
  ('11', 'Raja Ibrahim',        'Digital Marketer Intern',   'ibrahim@321', '#F59E0B'),
  ('12', 'Ameer Hamza',         'Video Editing Intern',      'hamza@321',   '#EF4444'),
  ('13', 'Ekam',                'Team Member',                'ekam123',     '#06B6D4')
on conflict (id) do update set
  name = excluded.name,
  designation = excluded.designation,
  password = excluded.password,
  color = excluded.color;

insert into manager_config (key, value) values
  ('manager_password', 'manager2024')
on conflict (key) do nothing;
