const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  // Plain text, matching the original Flask app's actual behavior (its own hash_password()
  // helper was defined but never used — app.py compares this column directly, unhashed).
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["admin", "management", "finance", "team_lead", "qaqc", "user"],
    default: "team_lead",
  },
  allowedTeams: { type: [String], default: [] }, // management only
  crossTeam: { type: Boolean, default: false },
  linkedTls: { type: [String], default: [] }, // user / qaqc roles
  defaultTl: { type: String, default: "" }, // qaqc only — auto-selected team on login
  birthday: { type: String, default: "" }, // "MM-DD", no year
});

module.exports = mongoose.model("User", userSchema);
