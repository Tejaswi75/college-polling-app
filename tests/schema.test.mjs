// Database tests: runs supabase/schema.sql in an in-process Postgres (PGlite) with a
// small stand-in for Supabase's auth schema, then checks constraints and row-level security.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const db = new PGlite();
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated;
`);
await db.exec(schema);
await db.exec(`
  grant usage on schema public, auth to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public, auth to authenticated;
`);

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const ALICE = "00000000-0000-0000-0000-0000000000a1";
const BOB = "00000000-0000-0000-0000-0000000000b0";
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${ADMIN}', 'admin@x.com', '{"full_name":"Admin"}'),
    ('${ALICE}', 'alice@x.com', '{"full_name":"Alice"}'),
    ('${BOB}',   'bob@x.com',   '{}');
  update public.profiles set role = 'admin' where email = 'admin@x.com';
`);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

// Run SQL as a signed-in user (RLS applies)
async function as(uid, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e }; }
  finally { await db.exec("reset role;"); }
}

const prof = await db.query("select email, full_name, role from public.profiles order by email");
ok("signup trigger creates profiles with names and default role", prof.rows.length === 3 &&
  prof.rows.find(r => r.email === "alice@x.com").full_name === "Alice" &&
  prof.rows.find(r => r.email === "bob@x.com").role === "voter");

// Admin creates a poll with candidates; a voter cannot
let r = await as(ADMIN, "insert into polls (title, created_by) values ('Class Rep 2026', $1) returning id", [ADMIN]);
const POLL = r.rows?.[0]?.id;
ok("admin can create a poll", !!POLL);
r = await as(ALICE, "insert into polls (title) values ('Hacked poll') returning id");
ok("voter cannot create a poll (RLS)", !!r.error);

r = await as(ADMIN, "insert into candidates (poll_id, name) values ($1,'Riya'),($1,'Arjun') returning id, name", [POLL]);
const RIYA = r.rows?.find(x => x.name === "Riya")?.id, ARJUN = r.rows?.find(x => x.name === "Arjun")?.id;
ok("admin can add candidates", !!RIYA && !!ARJUN);
r = await as(ADMIN, "insert into candidates (poll_id, name) values ($1,'Riya')", [POLL]);
ok("duplicate candidate name in a poll is rejected", r.error?.code === "23505");

// Voting rules
r = await as(ALICE, "insert into votes (poll_id, candidate_id, voter_id) values ($1,$2,$3)", [POLL, RIYA, ALICE]);
ok("voter can vote once", !r.error);
r = await as(ALICE, "insert into votes (poll_id, candidate_id, voter_id) values ($1,$2,$3)", [POLL, ARJUN, ALICE]);
ok("second vote in the same poll is rejected by a constraint", r.error?.code === "23505");
r = await as(ALICE, "insert into votes (poll_id, candidate_id, voter_id) values ($1,$2,$3)", [POLL, ARJUN, BOB]);
ok("cannot vote on behalf of another user (RLS)", !!r.error);

r = await as(ADMIN, "insert into polls (title) values ('Other poll') returning id");
const OTHER = r.rows[0].id;
r = await as(BOB, "insert into votes (poll_id, candidate_id, voter_id) values ($1,$2,$3)", [OTHER, RIYA, BOB]);
ok("cannot vote for a candidate from a different poll", !!r.error);

r = await as(ALICE, "update votes set candidate_id = $1 where voter_id = $2 returning id", [ARJUN, ALICE]);
ok("votes cannot be edited", (r.rows?.length ?? 0) === 0);
r = await as(ALICE, "delete from votes where voter_id = $1 returning id", [ALICE]);
ok("votes cannot be deleted", (r.rows?.length ?? 0) === 0);

r = await as(BOB, "select * from votes");
ok("voters cannot see other people's votes", r.rows?.length === 0);
r = await as(BOB, "select * from profiles");
ok("voters see only their own profile", r.rows?.length === 1);
r = await as(BOB, "update profiles set role = 'admin' where id = $1 returning id", [BOB]);
ok("voter cannot make themselves admin", (r.rows?.length ?? 0) === 0);

// Results visibility
r = await as(BOB, "select * from poll_results($1)", [POLL]);
ok("voters cannot see results while the poll is open", r.rows?.length === 0);
r = await as(ADMIN, "select * from poll_results($1)", [POLL]);
ok("admin sees live results", r.rows?.length === 2 && Number(r.rows[0].votes) === 1 && r.rows[0].name === "Riya");

await as(ADMIN, "update polls set is_open = false where id = $1", [POLL]);
r = await as(BOB, "insert into votes (poll_id, candidate_id, voter_id) values ($1,$2,$3)", [POLL, ARJUN, BOB]);
ok("cannot vote in a closed poll (RLS)", !!r.error);
r = await as(BOB, "select * from poll_results($1)", [POLL]);
ok("voters see results after the poll closes", r.rows?.length === 2);

r = await as(ADMIN, "select * from admin_stats()");
ok("admin stats", r.rows?.length === 1 && Number(r.rows[0].votes) === 1 && Number(r.rows[0].voters) === 2);
r = await as(BOB, "select * from admin_stats()");
ok("voters get no admin stats", r.rows?.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
