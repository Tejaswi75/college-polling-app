const express = require("express");
const { sendDbError } = require("../errors");

const router = express.Router();

const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Dashboard numbers
router.get("/stats", async (req, res) => {
  const { data, error } = await req.db.rpc("admin_stats");
  if (error) return sendDbError(res, error);
  const row = data?.[0] || {};
  res.json({
    polls: Number(row.polls || 0),
    open_polls: Number(row.open_polls || 0),
    voters: Number(row.voters || 0),
    votes: Number(row.votes || 0),
  });
});

// Create a poll together with its candidates
router.post("/polls", async (req, res) => {
  const title = clean(req.body?.title, 120);
  const description = clean(req.body?.description, 500);
  const names = [...new Set((req.body?.candidates || []).map((n) => clean(n, 80)).filter(Boolean))];

  if (title.length < 3) return res.status(400).json({ error: "Title must be at least 3 characters." });
  if (names.length < 2) return res.status(400).json({ error: "Add at least two different candidates." });

  const { data: poll, error } = await req.db
    .from("polls")
    .insert({ title, description, created_by: req.user.id })
    .select("id")
    .single();
  if (error) return sendDbError(res, error);

  const { error: candError } = await req.db
    .from("candidates")
    .insert(names.map((name) => ({ poll_id: poll.id, name })));
  if (candError) {
    await req.db.from("polls").delete().eq("id", poll.id); // don't leave a poll without candidates
    return sendDbError(res, candError);
  }
  res.status(201).json({ id: poll.id });
});

// Open or close a poll
router.patch("/polls/:id", async (req, res) => {
  if (typeof req.body?.is_open !== "boolean") return res.status(400).json({ error: "is_open must be true or false." });
  const { data, error } = await req.db
    .from("polls").update({ is_open: req.body.is_open }).eq("id", req.params.id).select("id, is_open");
  if (error) return sendDbError(res, error);
  if (!data.length) return res.status(404).json({ error: "Poll not found." });
  res.json(data[0]);
});

// Delete a poll (its candidates and votes are removed with it)
router.delete("/polls/:id", async (req, res) => {
  const { data, error } = await req.db.from("polls").delete().eq("id", req.params.id).select("id");
  if (error) return sendDbError(res, error);
  if (!data.length) return res.status(404).json({ error: "Poll not found." });
  res.status(204).end();
});

// Add a candidate to an existing poll
router.post("/polls/:id/candidates", async (req, res) => {
  const name = clean(req.body?.name, 80);
  const manifesto = clean(req.body?.manifesto, 500);
  if (!name) return res.status(400).json({ error: "Candidate name is required." });

  const { data, error } = await req.db
    .from("candidates").insert({ poll_id: req.params.id, name, manifesto }).select("id, name").single();
  if (error) return sendDbError(res, error, { "23505": [409, "A candidate with that name already exists in this poll."] });
  res.status(201).json(data);
});

// Remove a candidate
router.delete("/candidates/:id", async (req, res) => {
  const { data, error } = await req.db.from("candidates").delete().eq("id", req.params.id).select("id");
  if (error) return sendDbError(res, error);
  if (!data.length) return res.status(404).json({ error: "Candidate not found." });
  res.status(204).end();
});

module.exports = router;
