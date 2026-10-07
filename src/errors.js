// Turns database errors into clear HTTP responses.
// Codes are PostgreSQL error codes passed through by Supabase.
const MESSAGES = {
  "23505": [409, "That already exists."],                 // unique_violation
  "23503": [400, "That item does not belong here."],      // foreign_key_violation
  "23514": [400, "Some of the values are not allowed."],  // check_violation
  "42501": [403, "You are not allowed to do that."],      // RLS / insufficient privilege
};

function sendDbError(res, error, overrides = {}) {
  const [status, message] = overrides[error.code] || MESSAGES[error.code] || [500, "Something went wrong."];
  if (status === 500) console.error(error);
  return res.status(status).json({ error: message });
}

module.exports = { sendDbError };
