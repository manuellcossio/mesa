-- Mesa: per-user desk. Every row is scoped by user_id (the signed-in account).
-- Agents never send a user id; they present a desk key that resolves to one.

create table if not exists board_meta (
  user_id text primary key,
  key_hash text,
  focus text not null default '',
  calendar_synced_at timestamptz,
  calendar_status text not null default 'idle',
  calendar_detail text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  user_id text not null,
  name text not null,
  detail text not null default '',
  status text not null default 'active',
  progress int not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists projects_user_idx on projects (user_id, sort);

create table if not exists tasks (
  id text primary key,
  user_id text not null,
  title text not null,
  notes text not null default '',
  project_id text references projects (id) on delete set null,
  status text not null default 'open',
  priority text not null default 'normal',
  due date,
  source text not null default 'manuel',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_idx on tasks (user_id, status, due);

create table if not exists goals (
  id text primary key,
  user_id text not null,
  title text not null,
  detail text not null default '',
  progress int not null default 0,
  target int not null default 100,
  horizon text not null default '',
  status text not null default 'active',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists goals_user_idx on goals (user_id, sort);

create table if not exists events (
  id text primary key,
  user_id text not null,
  title text not null,
  detail text not null default '',
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  source text not null default 'desk',
  external_id text,
  project_id text references projects (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists events_user_idx on events (user_id, starts_at);
create unique index if not exists events_external_idx
  on events (user_id, source, external_id)
  where external_id is not null;

create table if not exists milestones (
  id text primary key,
  user_id text not null,
  title text not null,
  detail text not null default '',
  happens_on date not null,
  project_id text references projects (id) on delete set null,
  sort int not null default 0
);
create index if not exists milestones_user_idx on milestones (user_id, happens_on);

create table if not exists records (
  id text primary key,
  user_id text not null,
  kind text not null,
  title text not null,
  detail text not null default '',
  status text not null default 'open',
  counterparty text not null default '',
  url text not null default '',
  due date,
  source text not null default 'manuel',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists records_user_idx on records (user_id, updated_at desc);

create table if not exists threads (
  id text primary key,
  user_id text not null,
  title text not null,
  pinned boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists threads_user_idx on threads (user_id, updated_at desc);

create table if not exists messages (
  id text primary key,
  user_id text not null,
  thread_id text not null references threads (id) on delete cascade,
  author text not null,
  body text not null,
  addressed_to text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists messages_user_idx on messages (user_id, created_at);

create table if not exists agent_log (
  id text primary key,
  user_id text not null,
  agent text not null,
  summary text not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_log_user_idx on agent_log (user_id, created_at desc);
