const { authClient, clientForUser } = require("./supabase");

/**
 * Checks the "Authorization: Bearer <token>" header, loads the user's profile,
 * and attaches req.user, req.profile and req.db (a user-scoped database client).
 */
async function requireAuth(req, res, next) {
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in." });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Your session has expired. Please log in again." });

  const db = clientForUser(token);
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", data.user.id)
    .single();
  if (profileError || !profile) return res.status(403).json({ error: "Profile not found." });

  req.user = data.user;
  req.profile = profile;
  req.db = db;
  next();
}

/** Allows the request only for admins (the database enforces this too). */
function requireAdmin(req, res, next) {
  if (req.profile?.role !== "admin") return res.status(403).json({ error: "Admins only." });
  next();
}

module.exports = { requireAuth, requireAdmin };
