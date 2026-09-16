const mongoose = require("mongoose");

// Powers auto-incrementing human-facing IDs (Mongo has no SERIAL).
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

async function nextSequence(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

// Ensures the counter is at least `value` (used by the migration script to
// preserve legacy Postgres record IDs instead of renumbering from 1).
async function ensureAtLeast(name, value) {
  await Counter.findByIdAndUpdate(
    name,
    { $max: { seq: value } },
    { upsert: true }
  );
}

module.exports = { Counter, nextSequence, ensureAtLeast };
