alter table tasks add column if not exists ack text not null default 'read';
alter table tasks add column if not exists progress int not null default 0;

alter table board_meta add column if not exists weather_json text not null default '';
alter table board_meta add column if not exists weather_line text not null default '';
alter table board_meta add column if not exists weather_at timestamptz;

create table if not exists task_updates (
  id text primary key,
  user_id text not null,
  task_id text not null references tasks (id) on delete cascade,
  author text not null,
  kind text not null,
  body text not null default '',
  progress int,
  created_at timestamptz not null default now()
);
create index if not exists task_updates_user_idx on task_updates (user_id, created_at desc);

create table if not exists health_metrics (
  id text primary key,
  user_id text not null,
  metric text not null,
  value text not null,
  unit text not null default '',
  detail text not null default '',
  recorded_on date not null,
  source text not null default 'muse',
  created_at timestamptz not null default now()
);
create index if not exists health_metrics_user_idx on health_metrics (user_id, metric, recorded_on desc);

create table if not exists health_notes (
  id text primary key,
  user_id text not null,
  body text not null,
  author text not null,
  created_at timestamptz not null default now()
);
create index if not exists health_notes_user_idx on health_notes (user_id, created_at desc);
