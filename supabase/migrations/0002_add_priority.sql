set search_path to sprintanalise;

alter table sprintanalise.week_baseline_issues add column if not exists priority_name text;
alter table sprintanalise.issue_current_state add column if not exists priority_name text;

reset search_path;
