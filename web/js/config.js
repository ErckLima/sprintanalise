// Public by design: the anon key only grants read access (RLS) and the
// ability to call Edge Functions, which validate anything sensitive
// server-side. Never put the Redmine API key or the start-week password here.
export const SUPABASE_URL = "https://fsahjrulfwyhttnykjvb.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_ep-BCqc_IHUPr13Z7I90wA_5almrlCW";
export const REDMINE_BASE_URL = "http://177.69.209.157:65080/redmine";
