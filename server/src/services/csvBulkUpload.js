/**
 * Generic CSV bulk-uploader for the admin "Bulk Upload" page. Built against
 * the real Postgres CSV dumps under `psql/` (records.csv, users.csv, etc.) —
 * those files have NO header row, so each collection is parsed by a fixed
 * column order matched empirically against the samples, not by header name.
 */
const { parse } = require("csv-parse/sync");
const ExcelJS = require("exceljs");
const { Record, User, Team, Project, Client, ActivityLog, Notification, CompletedLog, RequestLog, EditingLog } = require("../models");
const { ensureAtLeast } = require("../models/Counter");
const { ensureBillableChangeOrder } = require("./changeOrderAuto");

function splitCsvList(s) {
  return String(s || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function toBool(s) {
  return ["t", "true", "1", "yes", "y"].includes(String(s || "").trim().toLowerCase());
}

/** Normalizes either boolean-ish ("true"/"1") or Yes/No text into the model's stored "Yes" | "No" | "" convention. */
function toYesNo(s) {
  const v = String(s || "").trim().toLowerCase();
  if (["t", "true", "1", "yes", "y"].includes(v)) return "Yes";
  if (["f", "false", "0", "no", "n"].includes(v)) return "No";
  return "";
}

/** Clamped 0-100 integer, defaulting to 0 for blank/invalid input. */
function toPercentage(s) {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Accepts 'YYYY-MM-DD[ HH:MM:SS[.ffffff]]' or 'MM-DD-YYYY[ HH:MM:SS]'; returns a Date or null. */
function parseFlexibleDateTime(s) {
  const str = String(s ?? "").trim();
  if (!str) return null;
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  }
  m = str.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  if (m) {
    const [, mo, d, y, h = "0", mi = "0", se = "0"] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseCsv(buffer) {
  return parse(buffer, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  });
}

/**
 * Each handler receives the raw parsed rows (arrays of strings) and does its
 * own upsert/insert. Returns { inserted, updated, skipped, errors }.
 */
const HANDLERS = {
  teams: async (rows) => simpleNameUpsert(rows, Team),
  projects: async (rows) => simpleNameUpsert(rows, Project),
  clients: async (rows) => simpleNameUpsert(rows, Client),

  // Creates the Client (if new) and the Project, and links them via
  // Project.client — one row per project, so a client with several
  // projects needs one row per project repeating the client name. Re-run
  // safe: a project's client link is overwritten to whatever this upload
  // says, since that's the whole point of this collection.
  clients_projects: async (rows) => {
    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];
    let projectsLinked = 0;
    for (const row of rows) {
      const client = (row[0] || "").trim();
      const project = (row[1] || "").trim();
      if (!client) {
        skipped++;
        continue;
      }
      try {
        const clientResult = await Client.updateOne({ name: client }, { name: client }, { upsert: true });
        if (clientResult.upsertedCount) inserted++;
        else updated++;
        if (project) {
          await Project.updateOne({ name: project }, { name: project, client }, { upsert: true });
          projectsLinked++;
        }
      } catch (e) {
        errors.push(`${client}${project ? ` / ${project}` : ""}: ${e.message}`);
      }
    }
    return {
      inserted,
      updated,
      skipped,
      errors,
      note: projectsLinked ? `Linked ${projectsLinked} project(s) to their client.` : undefined,
    };
  },

  users: async (rows) => {
    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];
    const teamNames = new Set();
    for (const row of rows) {
      const [username, password, role, allowedTeams, crossTeam, linkedTls, defaultTl, birthday] = row;
      if (!username || !password) {
        skipped++;
        continue;
      }
      const teams = splitCsvList(allowedTeams);
      teams.forEach((t) => teamNames.add(t));
      try {
        const result = await User.updateOne(
          { username: username.trim() },
          {
            username: username.trim(),
            password,
            role: (role || "team_lead").trim(),
            allowedTeams: teams,
            crossTeam: toBool(crossTeam),
            linkedTls: splitCsvList(linkedTls),
            defaultTl: (defaultTl || "").trim(),
            birthday: (birthday || "").trim(),
          },
          { upsert: true }
        );
        if (result.upsertedCount) inserted++;
        else updated++;
      } catch (e) {
        errors.push(`${username}: ${e.message}`);
      }
    }
    // Link teams: the Team collection is otherwise never touched by user
    // uploads, so any name in allowed_teams that doesn't exist yet as a
    // Team document is auto-created here to keep the two in sync.
    let teamsLinked = 0;
    if (teamNames.size) {
      const existing = await Team.find({ name: { $in: [...teamNames] } }).select("name").lean();
      const known = new Set(existing.map((t) => t.name));
      const missing = [...teamNames].filter((n) => !known.has(n));
      await Promise.all(
        missing.map((name) =>
          Team.updateOne({ name }, { name }, { upsert: true })
            .then(() => teamsLinked++)
            .catch((e) => errors.push(`team '${name}': ${e.message}`))
        )
      );
    }
    return {
      inserted,
      updated,
      skipped,
      errors,
      note: teamsLinked ? `Also created ${teamsLinked} team(s) referenced in allowed_teams that didn't exist yet.` : undefined,
    };
  },

  records: async (rows, uploadedBy) => {
    let inserted = 0, updated = 0, skipped = 0, changeOrdersCreated = 0;
    const errors = [];
    let maxLegacyId = 0;
    for (const row of rows) {
      const [
        legacyIdRaw, project, submissionName, client, submissionType, team,
        subDate, dueDate, remarks, status, createdAt, completedAt, createdBy,
        qaqc, backComment, furtherComment, percentage, billable, invoiceReleased,
      ] = row;
      const legacyId = parseInt(legacyIdRaw, 10);
      if (!legacyId || !project) {
        skipped++;
        continue;
      }
      maxLegacyId = Math.max(maxLegacyId, legacyId);
      try {
        const result = await Record.updateOne(
          { legacyId },
          {
            legacyId,
            project: project || "",
            submissionName: submissionName || "",
            client: client || "",
            submissionType: submissionType || "",
            team: team || "",
            subDate: parseFlexibleDateTime(subDate),
            dueDate: parseFlexibleDateTime(dueDate),
            remarks: remarks || "",
            status: status || "",
            createdAt: parseFlexibleDateTime(createdAt) || new Date(),
            completedAt: parseFlexibleDateTime(completedAt),
            createdBy: createdBy || "",
            qaqc: qaqc || "",
            backComment: backComment || "",
            furtherComment: furtherComment || "",
            percentage: toPercentage(percentage),
            billable: toYesNo(billable),
            invoiceReleased: toYesNo(invoiceReleased),
          },
          { upsert: true }
        );
        if (result.upsertedCount) inserted++;
        else updated++;

        // Same auto-CO behavior as the normal Add/Edit Record form — a
        // billable submission gets its own Change Order, skipped if one
        // already exists for this legacyId (see ensureBillableChangeOrder).
        if (toYesNo(billable) === "Yes") {
          const created = await ensureBillableChangeOrder(
            { legacyId, project: project || "", team: team || "", subDate: parseFlexibleDateTime(subDate), submissionName: submissionName || "", billable: "Yes" },
            uploadedBy || createdBy || ""
          );
          if (created) changeOrdersCreated++;
        }
      } catch (e) {
        errors.push(`legacyId ${legacyId}: ${e.message}`);
      }
    }
    if (maxLegacyId > 0) await ensureAtLeast("recordId", maxLegacyId);
    return {
      inserted,
      updated,
      skipped,
      errors,
      note: changeOrdersCreated ? `Auto-created ${changeOrdersCreated} Change Order(s) for billable record(s).` : undefined,
    };
  },

  hold_data: async (rows) => {
    // Merges into the matching Record's embedded `hold` field (there is no
    // separate hold_data collection in this port — see Record.hold).
    let updated = 0, skipped = 0;
    const errors = [];
    for (const row of rows) {
      const [recordIdRaw, holdText, imageFilename, holdUser, holdTs] = row;
      const legacyId = parseInt(recordIdRaw, 10);
      if (!legacyId) {
        skipped++;
        continue;
      }
      try {
        const result = await Record.updateOne(
          { legacyId },
          { hold: { text: holdText || "", imageFilename: imageFilename || "", user: holdUser || "", ts: parseFlexibleDateTime(holdTs) } }
        );
        if (result.matchedCount) updated++;
        else skipped++;
      } catch (e) {
        errors.push(`recordId ${legacyId}: ${e.message}`);
      }
    }
    return { inserted: 0, updated, skipped, errors, note: "Image files themselves are not copied — only the filename reference. Copy the actual files into server/uploads/hold_images/ separately." };
  },

  activity_log: async (rows) => appendOnly(rows, (row) => {
    const [, ts, username, action, detail] = row;
    return { ts: parseFlexibleDateTime(ts) || new Date(), username: username || "", action: action || "", detail: detail || "" };
  }, ActivityLog),

  notifications: async (rows) => {
    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const row of rows) {
      const [id, ts, byUser, action, detail, seenBy] = row;
      if (!id) {
        skipped++;
        continue;
      }
      try {
        const result = await Notification.updateOne(
          { _id: id },
          { _id: id, ts: parseFlexibleDateTime(ts) || new Date(), byUser: byUser || "", action: action || "", detail: detail || "", seenBy: splitCsvList(seenBy) },
          { upsert: true }
        );
        if (result.upsertedCount) inserted++;
        else updated++;
      } catch (e) {
        errors.push(`id ${id}: ${e.message}`);
      }
    }
    return { inserted, updated, skipped, errors };
  },

  completed_log: async (rows) => appendOnly(rows, (row) => {
    const [, archivedAt, recordId, project, submissionName, client, submissionType, team, subDate, dueDate, remarks, createdAt, completedAt, createdBy, archivedBy, qaqc] = row;
    return {
      archivedAt: parseFlexibleDateTime(archivedAt) || new Date(),
      recordId: parseInt(recordId, 10) || null,
      project: project || "", submissionName: submissionName || "", client: client || "",
      submissionType: submissionType || "", team: team || "", subDate: subDate || "", dueDate: dueDate || "",
      remarks: remarks || "", createdAt: createdAt || "", completedAt: completedAt || "",
      createdBy: createdBy || "", archivedBy: archivedBy || "", qaqc: qaqc || "",
    };
  }, CompletedLog),

  editing_log: async (rows) => appendOnly(rows, (row) => {
    const [, logId, uploadedAt, project, client, filename, uploadedBy, sheetName, detailedBy, checkedBy, correctedBy, qcDone, qcComment, remarks, sheetType, detailedByDone, checkedByDone, correctedByDone, qcCommentDone, allowedUsers] = row;
    return {
      logId: logId || "", uploadedAt: parseFlexibleDateTime(uploadedAt) || new Date(),
      project: project || "", client: client || "", filename: filename || "", uploadedBy: uploadedBy || "",
      sheetName: sheetName || "", sheetType: sheetType || "Detail",
      detailedBy: detailedBy || "", checkedBy: checkedBy || "", correctedBy: correctedBy || "",
      qcDone: qcDone || "", qcComment: qcComment || "", remarks: remarks || "",
      detailedByDone: detailedByDone || "0", checkedByDone: checkedByDone || "0",
      correctedByDone: correctedByDone || "0", qcCommentDone: qcCommentDone || "0",
      allowedUsers: splitCsvList(allowedUsers),
    };
  }, EditingLog),

  request_log: async (rows) => appendOnly(rows, (row) => {
    const [, ts, method, path, status, username, role, ip, durationMs, userAgent] = row;
    return {
      ts: parseFlexibleDateTime(ts) || new Date(), method: method || "", path: path || "",
      status: status || "", username: username || "", role: role || "", ip: ip || "",
      durationMs: parseInt(durationMs, 10) || 0, userAgent: userAgent || "",
    };
  }, RequestLog),
};

async function simpleNameUpsert(rows, Model) {
  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  for (const row of rows) {
    const name = (row[0] || "").trim();
    if (!name) {
      skipped++;
      continue;
    }
    try {
      const result = await Model.updateOne({ name }, { name }, { upsert: true });
      if (result.upsertedCount) inserted++;
      else updated++;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { inserted, updated, skipped, errors };
}

/** Log-type collections: no natural unique key beyond the dropped source id, so every valid row is appended. */
async function appendOnly(rows, mapRow, Model) {
  const docs = [];
  let skipped = 0;
  const errors = [];
  for (const row of rows) {
    try {
      docs.push(mapRow(row));
    } catch (e) {
      skipped++;
      errors.push(e.message);
    }
  }
  if (docs.length) await Model.insertMany(docs, { ordered: false }).catch((e) => errors.push(e.message));
  return { inserted: docs.length, updated: 0, skipped, errors };
}

const COLLECTIONS = [
  { key: "teams", label: "Teams", columns: "name" },
  { key: "projects", label: "Projects", columns: "name" },
  { key: "clients", label: "Clients", columns: "name" },
  { key: "clients_projects", label: "Clients & Projects (creates/links both)", columns: "client, project" },
  { key: "users", label: "Users", columns: "username, password, role, allowed_teams, cross_team, linked_tls, default_tl, birthday" },
  { key: "records", label: "Records", columns: "id, project, submission_name, client, submission_type, team, sub_date, due_date, remarks, status, created_at, completed_at, created_by, qaqc, back_comment, further_comment, percentage, billable, invoice_released" },
  { key: "hold_data", label: "Hold Data (merges into Records)", columns: "record_id, hold_text, image_filename, hold_user, hold_ts" },
  { key: "activity_log", label: "Activity Log", columns: "id, ts, username, action, detail" },
  { key: "notifications", label: "Notifications", columns: "id, ts, by_user, action, detail, seen_by" },
  { key: "completed_log", label: "Completed Log", columns: "id, archived_at, record_id, project, submission_name, client, submission_type, team, sub_date, due_date, remarks, created_at, completed_at, created_by, archived_by, qaqc" },
  { key: "editing_log", label: "Editing Log", columns: "id, log_id, uploaded_at, project, client, filename, uploaded_by, sheet_name, detailed_by, checked_by, corrected_by, qc_done, qc_comment, remarks, sheet_type, detailed_by_done, checked_by_done, corrected_by_done, qc_comment_done, allowed_users" },
  { key: "request_log", label: "Request Log", columns: "id, ts, method, path, status, username, role, ip, duration_ms, user_agent" },
];

async function runBulkUpload(collectionKey, buffer, uploadedBy) {
  const handler = HANDLERS[collectionKey];
  if (!handler) throw new Error(`Unknown collection '${collectionKey}'.`);
  const rows = parseCsv(buffer);
  return handler(rows, uploadedBy);
}

// Example data rows for the downloadable sample workbook — purely illustrative,
// keyed by the same collection the upload targets. Collections left out here
// (the pure event-log ones, which aren't hand-authored) still get a sample
// with just the header row, built from COLLECTIONS' `columns` string.
const SAMPLES = {
  teams: [["Team Alpha"], ["Team Bravo"]],
  projects: [["2516 City Of Tampa"], ["2546 Johns Hopkins All Children's Hospital"]],
  clients: [["Morrow Steel"], ["Acme Fabrication"]],
  clients_projects: [
    ["Morrow Steel", "2516 City Of Tampa"],
    ["Morrow Steel", "2546 Johns Hopkins All Children's Hospital"],
    ["Acme Fabrication", "3010 Riverside Tower"],
  ],
  users: [["jdoe", "changeme", "team_lead", "Team Alpha,Team Bravo", "false", "", "", "1990-05-12"]],
  records: [
    ["1001", "2516 City Of Tampa", "Anchor bolt field work dwgs", "Morrow Steel", "FAB", "Dhanil Kumar", "2026-04-14", "2026-04-14", "", "", "2026-04-01", "", "admin", "No", "No", "No", "35", "Yes", "No"],
  ],
  hold_data: [["1001", "Waiting on client approval", "", "admin", "2026-04-15 09:30:00"]],
};

/** Builds the downloadable "know the format" sample workbook for one collection — a header row (from COLLECTIONS) plus a couple of example rows where available. */
async function buildSampleWorkbook(collectionKey) {
  const meta = COLLECTIONS.find((c) => c.key === collectionKey);
  if (!meta) throw new Error(`Unknown collection '${collectionKey}'.`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sample");
  const headers = meta.columns.split(",").map((c) => c.trim());
  ws.addRow(headers).font = { bold: true };
  for (const row of SAMPLES[collectionKey] || []) ws.addRow(row);
  ws.columns.forEach((col) => {
    col.width = Math.max(14, ...col.values.filter(Boolean).map((v) => String(v).length + 2));
  });
  return wb;
}

module.exports = { runBulkUpload, COLLECTIONS, buildSampleWorkbook };
