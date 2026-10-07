const express = require("express");
const { sendDbError } = require("../errors");

const router = express.Router();

// List all polls, with candidate counts and whether the current user has voted
router.get("/", async (req, res) => {
  const { data: polls, error } = await req.db
    .from("polls")
    .select("id, title, description, is_open, created_at, candidates(count)")
    .order("created_at", { ascending: false });
  if (error) return sendDbError(res, error);

  const { data: myVotes, error: votesError } = await req.db
    .from("votes").select("poll_id").eq("voter_id", req.user.id);
  if (votesError) return sendDbError(res, votesError);
  const voted = new Set(myVotes.map((v) => v.poll_id));

  res.json(polls.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    is_open: p.is_open,
    created_at: p.created_at,
    candidate_count: p.candidates?.[0]?.count ?? 0,
    has_voted: voted.has(p.id),
  })));
});

// One poll with its candidates and the current user's vote (if any)
router.get("/:id", async (req, res) => {
  const { data: poll, error } = await req.db
    .from("polls")
    .select("id, title, description, is_open, created_at, candidates(id, name, manifesto)")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return sendDbError(res, error);
  if (!poll) return res.status(404).json({ error: "Poll not found." });

  const { data: myVote, error: voteError } = await req.db
    .from("votes").select("candidate_id")
    .eq("poll_id", poll.id).eq("voter_id", req.user.id)
    .maybeSingle();
  if (voteError) return sendDbError(res, voteError);

  poll.candidates.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ ...poll, my_vote: myVote?.candidate_id ?? null });
});

// Cast a vote. The database guarantees one vote per user per poll.
router.post("/:id/vote", async (req, res) => {
  const candidateId = req.body?.candidateId;
  if (!candidateId) return res.status(400).json({ error: "Choose a candidate." });

  const { error } = await req.db.from("votes").insert({
    poll_id: req.params.id,
    candidate_id: candidateId,
    voter_id: req.user.id,
  });
  if (error) {
    return sendDbError(res, error, {
      "23505": [409, "You have already voted in this poll."],
      "23503": [400, "That candidate is not part of this poll."],
      "42501": [403, "This poll is closed."],
    });
  }
  res.status(201).json({ message: "Your vote has been recorded." });
});

// Results: admins any time, voters once the poll is closed
router.get("/:id/results", async (req, res) => {
  const { data: poll, error } = await req.db
    .from("polls").select("id, title, is_open").eq("id", req.params.id).maybeSingle();
  if (error) return sendDbError(res, error);
  if (!poll) return res.status(404).json({ error: "Poll not found." });
  if (poll.is_open && req.profile.role !== "admin") {
    return res.status(403).json({ error: "Results are shown after the poll closes." });
  }

  const { data: rows, error: resultsError } = await req.db.rpc("poll_results", { p_poll: poll.id });
  if (resultsError) return sendDbError(res, resultsError);

  const total = rows.reduce((sum, r) => sum + Number(r.votes), 0);
  res.json({
    poll,
    total_votes: total,
    results: rows.map((r) => ({
      candidate_id: r.candidate_id,
      name: r.name,
      votes: Number(r.votes),
      percent: total ? Math.round((Number(r.votes) / total) * 1000) / 10 : 0,
    })),
  });
});

module.exports = router;
