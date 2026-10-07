require("dotenv").config();

const path = require("path");
const express = require("express");
const { authClient, SUPABASE_URL, SUPABASE_ANON_KEY } = require("./src/supabase");
const { requireAuth, requireAdmin } = require("./src/auth");
const pollRoutes = require("./src/routes/polls");
const adminRoutes = require("./src/routes/admin");

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

// The browser needs the public Supabase URL and anon key to sign users in.
// The anon key is designed to be public; row-level security protects the data.
// It also gets the college email domain so the sign-up form can check it early.
// The database enforces the same rule, so this is only for a friendlier message.
app.get("/api/config", async (req, res) => {
  const { data, error } = await authClient.rpc("allowed_email_domain");
  if (error) console.warn("Could not read allowed_email_domain:", error.message);
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, allowedEmailDomain: error ? null : data });
});

app.get("/api/me", requireAuth, (req, res) => res.json(req.profile));
app.use("/api/polls", requireAuth, pollRoutes);
app.use("/api/admin", requireAuth, requireAdmin, adminRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Express 5 forwards errors thrown in async handlers here
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`College Polling App running at http://localhost:${PORT}`));
