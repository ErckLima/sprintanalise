set search_path to sprintanalise;

alter table sprintanalise.week_baseline_issues add column if not exists project_id integer;
alter table sprintanalise.week_baseline_issues add column if not exists project_name text;
alter table sprintanalise.issue_current_state add column if not exists project_id integer;
alter table sprintanalise.issue_current_state add column if not exists project_name text;

reset search_path;
