"use client";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import PermissionEditor from "../../components/PermissionEditor";
import { api } from "../../lib/api";

/**
 * Admin-only app configuration. Independent "who can do X" lists — Invoice
 * Released editors, record updaters, record/change-order/RFI deleters —
 * each saved on its own. These replace the old shared update/delete
 * password gates (see server/src/routes/records.js, changeOrders.js,
 * rfis.js + settingsService.js).
 */
export default function SettingsPage() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings") });

  // Admins can already do all three of these unconditionally, so they're not
  // useful entries in any of the pickers — leave them out everywhere.
  const selectableUsers = (data?.users || []).filter((u) => u.role !== "admin");

  async function saveList(field, usernames) {
    const res = await api.post("/settings", { [field]: usernames });
    refetch();
    return res;
  }

  return (
    <AppLayout allow={["admin"]}>
      <PageHero theme="navy" icon="bi-gear-fill" title="Settings" meta="App-wide configuration" />

      {isLoading || !data ? (
        <p className="text-muted small">Loading…</p>
      ) : (
        <div className="settings-grid">
          <PermissionEditor
            icon="bi-receipt"
            color="blue"
            title="Invoice Released — Who Can Edit"
            description={
              'Admins can always edit the "Invoice Released" field on a record (in Add/Edit Record and the listing toggle). Pick anyone else who should also be able to.'
            }
            emptyNote="No one selected yet — only admins can edit Invoice Released."
            users={selectableUsers}
            initial={data.invoice_release_editors || []}
            onSave={(usernames) => saveList("invoice_release_editors", usernames)}
          />

          <PermissionEditor
            icon="bi-pencil-square"
            color="amber"
            title="Update Records — Who Can Edit"
            description="Admins can always update/edit a record. Pick anyone else who should also be able to — this replaces the old shared update password."
            emptyNote="No one selected yet — only admins can update records."
            users={selectableUsers}
            initial={data.record_updaters || []}
            onSave={(usernames) => saveList("record_updaters", usernames)}
          />

          <PermissionEditor
            icon="bi-trash"
            color="rose"
            title="Delete Records — Who Can Delete"
            description="Admins can always delete a record. Pick anyone else who should also be able to — this replaces the old shared delete password."
            emptyNote="No one selected yet — only admins can delete records."
            users={selectableUsers}
            initial={data.record_deleters || []}
            onSave={(usernames) => saveList("record_deleters", usernames)}
          />

          <PermissionEditor
            icon="bi-cash-stack"
            color="rose"
            title="Delete Change Orders — Who Can Delete"
            description="Admins can always delete a change order. Pick anyone else who should also be able to — this replaces the old shared delete password."
            emptyNote="No one selected yet — only admins can delete change orders."
            users={selectableUsers}
            initial={data.co_deleters || []}
            onSave={(usernames) => saveList("co_deleters", usernames)}
          />

          <PermissionEditor
            icon="bi-file-earmark-text"
            color="rose"
            title="Delete RFIs — Who Can Delete"
            description="Admins can always delete an RFI/Clarification. Pick anyone else who should also be able to — this replaces the old shared delete password."
            emptyNote="No one selected yet — only admins can delete RFIs."
            users={selectableUsers}
            initial={data.rfi_deleters || []}
            onSave={(usernames) => saveList("rfi_deleters", usernames)}
          />

          <PermissionEditor
            icon="bi-journal-check"
            color="green"
            title="Edit Completed Log — Who Can Edit"
            description="Admins can always edit an entry in the Completed Projects Log. Pick anyone else who should also be able to."
            emptyNote="No one selected yet — only admins can edit the Completed Log."
            users={selectableUsers}
            initial={data.completed_log_editors || []}
            onSave={(usernames) => saveList("completed_log_editors", usernames)}
          />
        </div>
      )}
    </AppLayout>
  );
}
