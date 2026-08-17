-- SprintAnalise schema, isolated from other data in this Supabase project.
create schema if not exists sprintanalise;

set search_path to sprintanalise;

create table sprintanalise.people (
  id bigint generated always as identity primary key,
  redmine_user_id integer not null unique,
  display_name text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table sprintanalise.weeks (
  id bigint generated always as identity primary key,
  label text,
  start_date date not null,
  started_at timestamptz not null default now(),
  is_current boolean not null default false
);

create unique index weeks_only_one_current on sprintanalise.weeks (is_current) where is_current;

create table sprintanalise.issue_statuses (
  id integer primary key,
  name text not null,
  is_closed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table sprintanalise.custom_field_defs (
  id integer primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

create table sprintanalise.week_baseline_issues (
  id bigint generated always as identity primary key,
  week_id bigint not null references sprintanalise.weeks (id),
  person_id bigint not null references sprintanalise.people (id),
  issue_id integer not null,
  subject text not null,
  status_id integer,
  status_name text,
  sprint_cf_value text,
  is_carryover boolean not null default false,
  captured_at timestamptz not null default now(),
  unique (week_id, issue_id)
);

create index week_baseline_issues_week_person on sprintanalise.week_baseline_issues (week_id, person_id);

create table sprintanalise.issue_current_state (
  id bigint generated always as identity primary key,
  week_id bigint not null references sprintanalise.weeks (id),
  person_id bigint not null references sprintanalise.people (id),
  issue_id integer not null,
  subject text,
  status_id integer,
  status_name text,
  sprint_cf_value text,
  present_in_sprint boolean not null default true,
  is_closed boolean not null default false,
  last_polled_at timestamptz not null default now(),
  unique (week_id, issue_id)
);

create index issue_current_state_person on sprintanalise.issue_current_state (person_id);
create index issue_current_state_week on sprintanalise.issue_current_state (week_id);

create table sprintanalise.issue_events (
  id bigint generated always as identity primary key,
  week_id bigint not null references sprintanalise.weeks (id),
  person_id bigint not null references sprintanalise.people (id),
  issue_id integer not null,
  event_type text not null check (event_type in ('added', 'removed_from_sprint', 'completed', 'status_changed', 'reverted_to_original')),
  from_status text,
  to_status text,
  source text not null check (source in ('scheduled_poll', 'manual_sync', 'week_start')),
  detected_at timestamptz not null default now()
);

create index issue_events_week_person on sprintanalise.issue_events (week_id, person_id);
create index issue_events_issue on sprintanalise.issue_events (issue_id);

create table sprintanalise.issue_history (
  issue_id integer primary key,
  first_seen_week_id bigint references sprintanalise.weeks (id),
  first_seen_at timestamptz,
  last_seen_week_id bigint references sprintanalise.weeks (id),
  last_seen_at timestamptz,
  times_seen_as_baseline integer not null default 0
);

create table sprintanalise.sync_runs (
  id bigint generated always as identity primary key,
  trigger_type text not null check (trigger_type in ('manual_sync', 'week_start')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('success', 'partial', 'error', 'skipped')),
  people_synced integer,
  issues_seen integer,
  events_created integer,
  error_message text
);

-- Row Level Security: public read-only. All writes go through Edge Functions
-- (service role, bypasses RLS) or the reorder_people RPC below.
alter table sprintanalise.people enable row level security;
alter table sprintanalise.weeks enable row level security;
alter table sprintanalise.issue_statuses enable row level security;
alter table sprintanalise.custom_field_defs enable row level security;
alter table sprintanalise.week_baseline_issues enable row level security;
alter table sprintanalise.issue_current_state enable row level security;
alter table sprintanalise.issue_events enable row level security;
alter table sprintanalise.issue_history enable row level security;
alter table sprintanalise.sync_runs enable row level security;

create policy "public read" on sprintanalise.people for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.weeks for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.issue_statuses for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.custom_field_defs for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.week_baseline_issues for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.issue_current_state for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.issue_events for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.issue_history for select to anon, authenticated using (true);
create policy "public read" on sprintanalise.sync_runs for select to anon, authenticated using (true);

-- Presentation order is not sensitive and doesn't touch Redmine, so it's a narrow
-- SECURITY DEFINER RPC instead of a full Edge Function.
create or replace function sprintanalise.reorder_people(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = sprintanalise
as $$
begin
  update sprintanalise.people p
  set display_order = o.ord
  from (select unnest(p_ids) as id, generate_subscripts(p_ids, 1) as ord) o
  where p.id = o.id;
end;
$$;

grant usage on schema sprintanalise to anon, authenticated;
grant execute on function sprintanalise.reorder_people(bigint[]) to anon, authenticated;
grant select on all tables in schema sprintanalise to anon, authenticated;

-- Edge Functions talk to Postgres through PostgREST using the service_role
-- key. RLS is bypassed for that role, but schema/table GRANTs are still
-- enforced, so it needs explicit write access.
grant usage on schema sprintanalise to service_role;
grant all privileges on all tables in schema sprintanalise to service_role;
grant all privileges on all sequences in schema sprintanalise to service_role;
grant execute on all functions in schema sprintanalise to service_role;
alter default privileges in schema sprintanalise grant all on tables to service_role;
alter default privileges in schema sprintanalise grant all on sequences to service_role;

-- Expose the schema to PostgREST (the Supabase JS client). If this doesn't take effect,
-- set it manually in Dashboard -> Settings -> API -> Data API -> Exposed schemas.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, sprintanalise';
notify pgrst, 'reload config';

reset search_path;
