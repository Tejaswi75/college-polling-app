# College Polling App

A secure online voting platform for college elections. Students sign up and vote; admins create polls, open and close them, and watch results on a dashboard.

The key rule, **one vote per student per poll**, is enforced by the database itself, not just by the app.

## Features

- **Sign up and log in** with email and password (Supabase Auth)
- **College emails only:** sign-ups outside the college domain (for example `@niet.co.in`) are rejected by the database, and email confirmation proves the student owns the inbox
- **Two roles:** voters and admins (role-based access control)
- **One vote per user per poll**, guaranteed by a database `UNIQUE` constraint
- **Votes are final:** they cannot be edited or deleted
- **Results:** admins see live counts; voters see results only after the poll closes
- **Admin dashboard:** create polls with candidates, open/close and delete polls, totals for polls, voters and votes
- **Row-level security:** the database checks every request, so even a direct API call cannot break the rules

## Tech stack

| Part | Technology |
|---|---|
| Backend | Node.js, Express 5 |
| Database and auth | Supabase (PostgreSQL + Supabase Auth) |
| Frontend | HTML, CSS, vanilla JavaScript |
| Tests | PGlite (Postgres running in-process) |

## How it works

```
Browser (public/)  ──login──▶  Supabase Auth  ──▶ access token
      │
      └── API calls with the token ──▶  Express server (server.js)
                                          │  checks the token, loads the user's role
                                          ▼
                                     Supabase Postgres
                                     constraints + row-level security
```

- The server talks to the database **as the logged-in user** (it forwards their token), so the database's row-level security rules apply to every query. The server never uses a key that bypasses those rules.
- `supabase/schema.sql` defines the tables and the rules:
  - `votes` has `UNIQUE (poll_id, voter_id)`: a second vote is rejected by Postgres.
  - A composite foreign key makes sure the chosen candidate belongs to the same poll.
  - Policies allow voting only as yourself and only while the poll is open, and allow only admins to manage polls.
  - Nobody can change their own role.
  - A trigger on `auth.users` rejects any sign-up, or email change, outside the domain in `app_settings`. It compares the whole domain, so look-alikes such as `fakeniet.co.in` or `niet.co.in.evil.com` fail too.

## Project structure

```
college-polling-app/
├── server.js              Express app: static files + API routes
├── src/
│   ├── supabase.js        Supabase clients (auth check + per-user client)
│   ├── auth.js            requireAuth / requireAdmin middleware
│   ├── errors.js          Database error → clear HTTP message
│   └── routes/
│       ├── polls.js       List polls, view a poll, vote, results
│       └── admin.js       Stats, create/close/delete polls, candidates
├── public/                index.html, app.js, styles.css (the UI)
├── supabase/schema.sql    Tables, constraints, row-level security, functions
└── tests/schema.test.mjs  29 tests for the constraints and security rules
```

## Run it locally

1. **Create a Supabase project** (free) at [supabase.com](https://supabase.com).
2. In the Supabase dashboard open **SQL Editor**, paste the contents of `supabase/schema.sql`, and click **Run**.
3. **Set your college's email domain.** The schema allows only `@niet.co.in`. For another college, run:
   ```sql
   update public.app_settings set allowed_email_domain = 'yourcollege.edu';
   ```
   Set it to `null` to allow any email while testing.
4. In **Authentication → Sign In / Providers → Email**, keep **Confirm email** on for real use, so students must click a link sent to their college inbox. You can turn it off for local testing; the free Supabase email service sends only a few emails per hour.
5. Install and configure:
   ```bash
   npm install
   cp .env.example .env      # then fill in SUPABASE_URL and SUPABASE_ANON_KEY
   npm start
   ```
   Find both values under **Project Settings → API**. Open [http://localhost:3000](http://localhost:3000).
6. **Make yourself admin:** sign up in the app, then run this in the SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   Log out and back in to see the **Admin dashboard**.

## Tests

```bash
npm test
```

Runs the schema in an in-process Postgres and checks 29 rules, for example: a second vote is rejected, non-college emails cannot sign up, voters cannot vote for another user or in a closed poll, votes cannot be edited or deleted, voters cannot see results while a poll is open, and voters cannot make themselves admin.

## API

All routes need `Authorization: Bearer <access token>`; `/api/admin/*` also needs the admin role.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/me` | Current user's profile and role |
| GET | `/api/polls` | All polls, with candidate counts and whether you voted |
| GET | `/api/polls/:id` | One poll with candidates and your vote |
| POST | `/api/polls/:id/vote` | Vote: body `{ "candidateId": "..." }` |
| GET | `/api/polls/:id/results` | Vote counts (admins any time, voters after closing) |
| GET | `/api/admin/stats` | Totals for the dashboard |
| POST | `/api/admin/polls` | Create a poll: `{ title, description, candidates: [names] }` |
| PATCH | `/api/admin/polls/:id` | Open or close: `{ "is_open": false }` |
| DELETE | `/api/admin/polls/:id` | Delete a poll and its votes |
| POST | `/api/admin/polls/:id/candidates` | Add a candidate |
| DELETE | `/api/admin/candidates/:id` | Remove a candidate |

## License

MIT
