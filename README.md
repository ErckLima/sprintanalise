# SprintAnalise

Acompanhador de sprint semanal do Redmine. Front-end estático (GitHub Pages) +
Postgres num schema isolado (`sprintanalise`) de um projeto Supabase existente +
Supabase Edge Functions para tudo que precisa da API key do Redmine ou da senha
de "Iniciar a Semana".

## Estrutura

- `supabase/migrations/0001_init.sql` — schema, RLS, RPC de reordenação.
- `supabase/functions/` — Edge Functions (`discover-people`, `sync`, `start-week`)
  e helpers compartilhados em `_shared/`.
- `web/` — front-end estático publicado no GitHub Pages (sem build step).

## Configuração necessária

Secrets da Edge Function (`supabase secrets set ...`):

- `REDMINE_BASE_URL` — inclui o subpath `/redmine`.
- `REDMINE_API_KEY`
- `REDMINE_TRACKER_ID` (hoje `42`)
- `SPRINT_CF_ID` (hoje `255`)
- `START_WEEK_PASSWORD`

`web/js/config.js` (público, ok commitar): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`REDMINE_BASE_URL`.

## Deploy

1. Aplicar `supabase/migrations/0001_init.sql` no projeto Supabase (SQL Editor
   ou `supabase db push`).
2. Se as tabelas não aparecerem no client JS, confirmar em Dashboard →
   Settings → API → Data API → Exposed schemas que `sprintanalise` está na
   lista (o migration já tenta configurar isso via `ALTER ROLE authenticator`).
3. `supabase functions deploy discover-people sync start-week`.
4. Configurar os secrets acima.
5. Preencher `web/js/config.js` com a anon key do projeto.
6. Push para `main` — o workflow `.github/workflows/deploy-pages.yml` publica
   `web/` no GitHub Pages.
