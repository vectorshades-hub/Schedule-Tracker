"use client";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

/**
 * Role-conditional field set shared by the Add User and Edit User forms —
 * only the fields relevant to the selected role are included in what gets
 * submitted (the parent builds its payload from `form`, so there's no need
 * for the original's "disable hidden checkboxes" DOM trick).
 */
export default function UserRoleFields({ form, setForm, teamLeadAndMgmtUsernames }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      <div className="mb-2">
        <label className="form-label">Role</label>
        <select className="form-select" value={form.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="team_lead">Team Lead</option>
          <option value="management">Management</option>
          <option value="finance">Finance</option>
          <option value="qaqc">QAQC</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {form.role === "management" && (
        <div className="mb-2 border rounded p-2">
          <div className="fw-semibold mb-1">Allowed Teams</div>
          {teamLeadAndMgmtUsernames.map((u) => (
            <label key={u} className="d-block">
              <input
                type="checkbox"
                className="form-check-input me-1"
                checked={form.allowed_teams_chk?.includes(u) || false}
                onChange={(e) =>
                  set({
                    allowed_teams_chk: e.target.checked
                      ? [...(form.allowed_teams_chk || []), u]
                      : (form.allowed_teams_chk || []).filter((x) => x !== u),
                  })
                }
              />
              {u}
            </label>
          ))}
          <label className="d-block mt-1">
            <input type="checkbox" className="form-check-input me-1" checked={form.cross_team === "1"} onChange={(e) => set({ cross_team: e.target.checked ? "1" : "0" })} />
            Allow all team leads to view each other&apos;s records
          </label>
        </div>
      )}

      {(form.role === "user" || form.role === "qaqc") && (
        <div className="mb-2 border rounded p-2">
          <div className="fw-semibold mb-1">Linked Team Leads</div>
          {teamLeadAndMgmtUsernames.map((u) => (
            <label key={u} className="d-block">
              <input
                type="checkbox"
                className="form-check-input me-1"
                checked={form.linked_tls_chk?.includes(u) || false}
                onChange={(e) =>
                  set({
                    linked_tls_chk: e.target.checked
                      ? [...(form.linked_tls_chk || []), u]
                      : (form.linked_tls_chk || []).filter((x) => x !== u),
                  })
                }
              />
              {u}
            </label>
          ))}
          {form.role === "qaqc" && (
            <div className="mt-2 p-2 bg-light rounded">
              <div className="fw-semibold small mb-1">Default Team (auto-selected on login)</div>
              <label className="d-block">
                <input type="radio" name="default_tl_radio" className="form-check-input me-1" checked={!form.default_tl_radio} onChange={() => set({ default_tl_radio: "" })} />
                None
              </label>
              {(form.linked_tls_chk || []).map((u) => (
                <label key={u} className="d-block">
                  <input type="radio" name="default_tl_radio" className="form-check-input me-1" checked={form.default_tl_radio === u} onChange={() => set({ default_tl_radio: u })} />
                  {u}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="row g-2 mb-2">
        <div className="col">
          <label className="form-label">Birthday Month</label>
          <select className="form-select" value={form.bday_month || ""} onChange={(e) => set({ bday_month: e.target.value })}>
            <option value="">—</option>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="col">
          <label className="form-label">Day</label>
          <select className="form-select" value={form.bday_day || ""} onChange={(e) => set({ bday_day: e.target.value })}>
            <option value="">—</option>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}
