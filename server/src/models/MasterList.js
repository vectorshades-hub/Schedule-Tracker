const mongoose = require("mongoose");

// Same shape used for teams, projects and clients — three separate
// collections (not one shared collection) so each keeps its own
// uniqueness constraint, mirroring the three separate Postgres tables.
const nameSchema = { name: { type: String, required: true, unique: true, trim: true } };

const Team = mongoose.model("Team", new mongoose.Schema(nameSchema));

// A project belongs to exactly one client, referenced by name (matching the
// name-string convention Record already uses for `project`/`client` rather
// than an ObjectId ref) — "" means unassigned (legacy projects predating
// this field, or a project whose client was deleted). A client, in turn,
// carries no back-reference: it's looked up by querying Project.client.
const projectSchema = new mongoose.Schema({
  ...nameSchema,
  client: { type: String, default: "", trim: true },
  // Project-level completion signoff (Project Lifecycle widget's "Mark
  // Project Completed" button) — distinct from any individual record's own
  // `status`/`completedAt`: it's only settable once every record under this
  // project is itself completed (checked server-side in POST /api/projects
  // action=mark_completed), and gets cleared again the moment a fresh
  // record is added to the project (POST /api/records — a new submission
  // means the project isn't done anymore, so the signoff no longer holds).
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  // Manual per-stage signoffs for the Project Lifecycle widget's OFA/
  // Fabrication circles — unlike `completed` above these are fully manual
  // (no "every record already completed" gate; POST /api/projects
  // action=mark_ofa_completed / mark_fab_completed just sets them
  // directly), but they're cleared the same way: a fresh submission of the
  // matching type added to the project (POST /api/records) means that
  // stage isn't really done anymore, so the signoff no longer holds.
  ofaCompleted: { type: Boolean, default: false },
  ofaCompletedAt: { type: Date, default: null },
  fabCompleted: { type: Boolean, default: false },
  fabCompletedAt: { type: Date, default: null },
});
const Project = mongoose.model("Project", projectSchema);
const Client = mongoose.model("Client", new mongoose.Schema(nameSchema));

module.exports = { Team, Project, Client };
