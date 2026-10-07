// College Polls: browser app. Supabase handles login; our API handles everything else.

let sb = null;          // Supabase client (auth only)
let me = null;          // current user's profile
let authMode = "login";
let emailDomain = null; // e.g. "niet.co.in"; null means any email is allowed

const $ = (id) => document.getElementById(id);
const views = ["authView", "pollsView", "pollView", "adminView"];

// Escape text before putting it in HTML (user-entered titles and names)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function show(view) {
  views.forEach((v) => ($(v).hidden = v !== view));
  window.scrollTo(0, 0);
}

function toast(message, isError = false) {
  const t = $("toast");
  t.textContent = message;
  t.className = "toast" + (isError ? " error" : "");
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

// Call our API with the user's access token
async function api(path, options = {}) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed.");
  return body;
}

// ---------------- auth ----------------
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  $("nameRow").hidden = mode !== "signup";
  $("authSubmit").textContent = mode === "signup" ? "Create account" : "Log in";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("emailHint").hidden = !(mode === "signup" && emailDomain);
}

const isCollegeEmail = (email) => !emailDomain || email.toLowerCase().endsWith("@" + emailDomain.toLowerCase());

async function onAuthSubmit(e) {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  $("authSubmit").disabled = true;
  try {
    if (authMode === "signup") {
      if (!isCollegeEmail(email)) throw new Error(`Please sign up with your @${emailDomain} college email.`);
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { full_name: $("fullName").value.trim() } },
      });
      if (error) throw error;
      if (!data.session) { toast("Account created. Check your email to confirm it, then log in."); setAuthMode("login"); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    await enterApp();
  } catch (err) {
    // Supabase hides the database's reason behind this generic message
    const blocked = authMode === "signup" && /database error saving new user/i.test(err.message);
    toast(blocked ? `Please sign up with your @${emailDomain || "college"} email.` : err.message, true);
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function enterApp() {
  try {
    me = await api("/api/me");
  } catch (err) {
    toast(err.message, true);
    return show("authView");
  }
  $("who").hidden = false;
  $("whoName").textContent = me.full_name || me.email;
  $("whoRole").textContent = me.role;
  $("adminBtn").hidden = me.role !== "admin";
  await loadPolls();
}

// ---------------- polls ----------------
async function loadPolls() {
  const polls = await api("/api/polls").catch((err) => { toast(err.message, true); return []; });
  const list = $("pollList");
  list.innerHTML = polls.length ? "" : '<p class="muted">No polls yet.</p>';
  polls.forEach((p) => {
    const card = document.createElement("button");
    card.className = "card poll-card";
    card.innerHTML = `
      <div class="row-between">
        <h3>${esc(p.title)}</h3>
        <span class="status ${p.is_open ? "open" : "closed"}">${p.is_open ? "Open" : "Closed"}</span>
      </div>
      <p class="muted">${esc(p.description) || "&nbsp;"}</p>
      <p class="small">${p.candidate_count} candidates · ${p.has_voted ? "✅ You voted" : p.is_open ? "Not voted yet" : "Voting ended"}</p>`;
    card.onclick = () => openPoll(p.id);
    list.appendChild(card);
  });
  show("pollsView");
}

async function openPoll(id) {
  let poll;
  try { poll = await api(`/api/polls/${id}`); } catch (err) { return toast(err.message, true); }

  $("pollTitle").textContent = poll.title;
  $("pollDesc").textContent = poll.description;
  $("pollStatus").textContent = poll.is_open ? "Open" : "Closed";
  $("pollStatus").className = "status " + (poll.is_open ? "open" : "closed");

  const form = $("voteForm");
  const canVote = poll.is_open && !poll.my_vote;
  form.innerHTML = poll.candidates.map((c) => `
    <label class="option ${poll.my_vote === c.id ? "chosen" : ""}">
      <input type="radio" name="candidate" value="${c.id}" ${canVote ? "" : "disabled"} ${poll.my_vote === c.id ? "checked" : ""}>
      <span><strong>${esc(c.name)}</strong>${c.manifesto ? `<br><span class="muted small">${esc(c.manifesto)}</span>` : ""}</span>
    </label>`).join("") +
    (canVote ? '<button type="submit">Submit vote</button>'
      : `<p class="muted small">${poll.my_vote ? "You have voted in this poll. Votes cannot be changed." : "This poll is closed."}</p>`);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const choice = form.querySelector('input[name="candidate"]:checked');
    if (!choice) return toast("Choose a candidate first.", true);
    if (!confirm("Submit your vote? It cannot be changed later.")) return;
    try {
      const r = await api(`/api/polls/${id}/vote`, { method: "POST", body: { candidateId: choice.value } });
      toast(r.message);
      openPoll(id);
    } catch (err) { toast(err.message, true); }
  };

  $("results").innerHTML = "";
  if (!poll.is_open || me.role === "admin") await renderResults(id, $("results"));
  show("pollView");
}

async function renderResults(pollId, target) {
  try {
    const data = await api(`/api/polls/${pollId}/results`);
    target.innerHTML = `<h3>Results <span class="muted small">(${data.total_votes} votes${data.poll.is_open ? ", live" : ""})</span></h3>` +
      data.results.map((r, i) => `
        <div class="result">
          <div class="row-between"><span>${i === 0 && r.votes > 0 ? "🏆 " : ""}${esc(r.name)}</span><span>${r.votes} · ${r.percent}%</span></div>
          <div class="bar"><div style="width:${r.percent}%"></div></div>
        </div>`).join("");
  } catch (err) {
    target.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
  }
}

// ---------------- admin ----------------
async function loadAdmin() {
  try {
    const s = await api("/api/admin/stats");
    $("stats").innerHTML = [["Polls", s.polls], ["Open", s.open_polls], ["Voters", s.voters], ["Votes cast", s.votes]]
      .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
  } catch (err) { toast(err.message, true); }

  const polls = await api("/api/polls").catch(() => []);
  $("adminPolls").innerHTML = polls.length ? "" : '<p class="muted">No polls yet.</p>';
  polls.forEach((p) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div><strong>${esc(p.title)}</strong> <span class="status ${p.is_open ? "open" : "closed"}">${p.is_open ? "Open" : "Closed"}</span>
        <div class="small muted">${p.candidate_count} candidates</div></div>
      <div class="actions">
        <button class="ghost" data-act="view">Results</button>
        <button class="ghost" data-act="toggle">${p.is_open ? "Close" : "Reopen"}</button>
        <button class="ghost danger" data-act="delete">Delete</button>
      </div>`;
    row.querySelector('[data-act="view"]').onclick = () => openPoll(p.id);
    row.querySelector('[data-act="toggle"]').onclick = async () => {
      try { await api(`/api/admin/polls/${p.id}`, { method: "PATCH", body: { is_open: !p.is_open } }); loadAdmin(); }
      catch (err) { toast(err.message, true); }
    };
    row.querySelector('[data-act="delete"]').onclick = async () => {
      if (!confirm(`Delete "${p.title}" and all its votes?`)) return;
      try { await api(`/api/admin/polls/${p.id}`, { method: "DELETE" }); toast("Poll deleted."); loadAdmin(); }
      catch (err) { toast(err.message, true); }
    };
    $("adminPolls").appendChild(row);
  });
  show("adminView");
}

async function onCreatePoll(e) {
  e.preventDefault();
  const candidates = $("newCands").value.split("\n").map((s) => s.trim()).filter(Boolean);
  try {
    await api("/api/admin/polls", {
      method: "POST",
      body: { title: $("newTitle").value, description: $("newDesc").value, candidates },
    });
    e.target.reset();
    toast("Poll created.");
    loadAdmin();
  } catch (err) { toast(err.message, true); }
}

// ---------------- start ----------------
async function start() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  emailDomain = cfg.allowedEmailDomain || null;
  if (emailDomain) {
    $("emailHint").textContent = `Use your @${emailDomain} email.`;
    $("email").placeholder = `you@${emailDomain}`;
  }

  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setAuthMode(t.dataset.tab)));
  $("authForm").onsubmit = onAuthSubmit;
  $("createForm").onsubmit = onCreatePoll;
  $("adminBtn").onclick = loadAdmin;
  $("logoutBtn").onclick = async () => { await sb.auth.signOut(); me = null; $("who").hidden = true; show("authView"); };
  document.querySelectorAll("[data-go='polls']").forEach((b) => (b.onclick = loadPolls));

  const { data } = await sb.auth.getSession();
  if (data.session) await enterApp(); else show("authView");
}

start().catch((err) => toast("Could not start the app: " + err.message, true));
