import { createClient } from '@supabase/supabase-js'

// Public by design: access is limited by row-level security in supabase/schema.sql.
export const SUPABASE_URL = 'https://josvpzxqzquxjxqlclux.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kKLDCuoXfrQ7N4rNLvdWGg_Q1dTSTUy'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // PKCE puts the confirmation code in ?code=…, which doesn't clash with Haru's #/ routes.
    flowType: 'pkce',
    detectSessionInUrl: true,
  },
})

/** The address email links should open: the app itself, without query or hash. */
export function appUrl() {
  return `${window.location.origin}${window.location.pathname}`
}
