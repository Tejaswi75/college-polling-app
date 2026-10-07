const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.");
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Used only to verify access tokens
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);

/**
 * A client that acts as the signed-in user. Every query it makes goes through
 * the database's row-level security policies for that user, so the server
 * never has more access than the person using it.
 */
function clientForUser(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

module.exports = { authClient, clientForUser, SUPABASE_URL, SUPABASE_ANON_KEY };
