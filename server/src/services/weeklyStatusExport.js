/**
 * Builds the "Weekly Project Status" report for one project — same layout
 * as the hand-made customer report (header block, Pending RFIs, Upcoming
 * Planned Submissions, Unapproved Change Orders, BFA/IFA Tracking, Key
 * Actions), plus a Supportive Document listing multi-question RFIs' open
 * questions. Fields the app doesn't track (Client Project Manager, Project #,
 * key actions) are left blank for the user to fill in.
 *
 * buildWeeklyStatusData() gathers the rows once; buildWeeklyStatusWorkbook()
 * (.xlsx) and buildWeeklyStatusPdf() (.pdf) render that same data.
 */
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const statusEngine = require("./statusEngine");

// Full Vectorshades wordmark (572×168) from the client's public assets.
const LOGO_PATH = path.join(__dirname, "..", "..", "..", "client", "public", "vs-logo_full.jpg");

// Columns A–H. Most sections pair D:E and G:H into one column each; the BFA
// section keeps H alone so its days column is narrow and Description (C:G) wide.
const COL_WIDTHS = [10, 14, 26, 12, 10, 18, 10, 12];
const LAST_COL = "H";

const FILL_TITLE = "FFCFC6A6";
const FILL_VALUE = "FFFFFFCC";
const FILL_SECTION = "FF808080";
const FILL_COLHEAD = "FFD9D9D9";
const LINK_COLOR = "FF0563C1";

const thin = { style: "thin", color: { argb: "FF000000" } };
const medium = { style: "medium", color: { argb: "FF000000" } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

// Minimum row counts per section, so the report keeps its blank fill-in lines
// like the template even when there's little data.
const MIN_ROWS = { rfis: 8, submissions: 8, changeOrders: 6, bfa: 8, keyActions: 10 };

const COMPLETED_TAGS = new Set(["completed", "completed_overdue"]);

// A completed submission still without a BFA receipt date goes on the BFA
// Tracking section once it's been waiting more than this many days.
const BFA_WAIT_DAYS = 10;

const SUPPORT_SHEET = "Supportive Document";
const NO_CO_TEXT = "NIL- No Unapproved CO currently awaiting customer action";

// Column layouts per section: [from, to, label, align?]
const SECTIONS = {
  rfis: {
    title: "1. PENDING RFIs / CLARIFICATIONS",
    cols: [["A", "A", "RFI#"], ["B", "B", "RFI Sent on"], ["C", "E", "RFI Description"], ["F", "F", "Response req'd by"], ["G", "H", "Impacted submittals"]],
  },
  upcoming: {
    title: "2. UPCOMING PLANNED SUBMISSIONS",
    cols: [["A", "C", "Submission / Package"], ["D", "E", "Planned Date"], ["F", "F", "Submission Type"], ["G", "H", "Pending RFI"]],
  },
  unapproved: {
    title: "3. UNAPPROVED CHANGE ORDERS",
    cols: [["A", "A", "CO#"], ["B", "B", "Sent Date"], ["C", "F", "Description"], ["G", "H", "Days Awaited", "center"]],
  },
  awaiting: {
    title: "4. BFA / IFA TRACKING",
    cols: [["A", "A", "TR#"], ["B", "B", "Submitted date"], ["C", "G", "Description"], ["H", "H", "Days awaited", "center"]],
  },
};

function daysSince(d) {
  const p = statusEngine.parseDate(d);
  return p ? Math.max(0, Math.round((statusEngine.todayUTC() - p) / 86400000)) : null;
}

/** "test title" → "Test Title" — same as CSS text-transform: capitalize (rest of each word left as typed). */
function capitalizeWords(s) {
  return String(s || "").replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase());
}

/**
 * "RFI#123", "RFI#123 & #132", "RFI#123, #132, #232 & #343" — only the first
 * numbered RFI carries the "RFI" prefix; an RFI with no number is listed by title.
 */
function formatRfiList(rfis) {
  let prefixed = false;
  const labels = rfis.map((rfi) => {
    if (!rfi.rfiNumber) return capitalizeWords(rfi.title);
    const label = `${prefixed ? "" : "RFI"}#${rfi.rfiNumber}`;
    prefixed = true;
    return label;
  });
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}` : labels.join("");
}

function rfiIsReturned(rfi) {
  const qs = rfi.questions || [];
  if (qs.length) return qs.every((q) => q.responseReceivedDate);
  return !!rfi.actualReturnDate;
}

/** A multi-question RFI with at least one question still awaiting a response (none or only some answered). */
function hasOpenQuestions(rfi) {
  const qs = rfi.questions || [];
  return qs.length > 1 && qs.some((q) => !q.responseReceivedDate);
}

const bySentDate = (a, b) => (statusEngine.parseDate(a.date || a.createdAt) || 0) - (statusEngine.parseDate(b.date || b.createdAt) || 0);

/**
 * Gathers every row of the report. Dates are UTC-midnight calendar-day Dates
 * (or null). Each renderer pads sections out to MIN_ROWS itself.
 *
 * @param {object} p
 * @param {string} p.projectName
 * @param {string} p.clientName
 * @param {string} p.createdBy
 * @param {object[]} p.records       rowToRecord() rows for this project (viewer-scoped)
 * @param {object[]} p.rfis          raw Rfi docs
 * @param {object[]} p.changeOrders  raw ChangeOrder docs (viewer-scoped)
 * @param {Map<number,string>} p.submissionNames  legacyId → submission name
 */
function buildWeeklyStatusData({ projectName, clientName, createdBy, records, rfis, changeOrders, submissionNames }) {
  const date = (d) => statusEngine.parseDate(d);
  const today = statusEngine.todayUTC();
  const pad = (n) => String(n).padStart(2, "0");

  const header = [
    ["Client Name", clientName],
    ["Client Project Manager", ""],
    ["Project #", ""],
    ["Project Name", projectName],
    ["Report Week", `${pad(today.getUTCDate())}-${pad(today.getUTCMonth() + 1)}-${today.getUTCFullYear()}`],
    ["Created By", createdBy],
  ];

  // ── 1. Pending RFIs — a multi-question RFI gets a follow-up line pointing
  // at its open questions in the Supportive Document (support[supportIndex]).
  const pendingRfis = rfis.filter((r) => !rfiIsReturned(r)).sort(bySentDate);
  const rfiRows = [];
  const support = [];
  for (const r of pendingRfis) {
    rfiRows.push({
      kind: "rfi",
      num: /^\d+$/.test(r.rfiNumber || "") ? Number(r.rfiNumber) : r.rfiNumber || "",
      sent: date(r.date || r.createdAt),
      title: capitalizeWords(r.title),
      due: date(r.expectedResponseDate),
      impacted: [...new Set((r.linkedSubmissionIds || []).map((id) => submissionNames.get(id)).filter(Boolean))].join(", "),
    });
    if (!hasOpenQuestions(r)) continue;

    const qs = r.questions || [];
    const open = qs.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => !q.responseReceivedDate);
    const sentIso = statusEngine.fmtDateOnlyISO(r.date || r.createdAt);
    const dueIso = statusEngine.fmtDateOnlyISO(r.expectedResponseDate);
    const days = daysSince(r.date || r.createdAt);
    rfiRows.push({
      kind: "followUp",
      text: `Awaiting response: ${open.map(({ n }) => `Q${n}`).join(", ")} (${open.length} of ${qs.length}) – see details`,
      supportIndex: support.length,
    });
    support.push({
      heading: `${r.rfiNumber ? `RFI#${r.rfiNumber} – ` : ""}${capitalizeWords(r.title)}`,
      meta: `${qs.length - open.length} of ${qs.length} questions answered` + (sentIso ? ` · Sent ${sentIso}` : "") + (dueIso ? ` · Response req'd by ${dueIso}` : ""),
      questions: open.map(({ q, n }) => ({ label: `Q${n}`, text: q.text, days })),
    });
  }

  // ── 2. Upcoming planned submissions
  const pendingRfisBySubmission = new Map();
  for (const r of pendingRfis) {
    for (const id of r.linkedSubmissionIds || []) {
      if (!pendingRfisBySubmission.has(id)) pendingRfisBySubmission.set(id, []);
      pendingRfisBySubmission.get(id).push(r);
    }
  }
  const upcoming = records
    .filter((r) => !COMPLETED_TAGS.has(r.tag))
    .sort((a, b) => (a.due_date_raw || "9999").localeCompare(b.due_date_raw || "9999"))
    .map((r) => ({
      name: r.submission_name,
      planned: date(r.due_date_raw),
      type: r.submission_type,
      pendingRfi: formatRfiList(pendingRfisBySubmission.get(Number(r.id)) || []),
    }));

  // ── 3. Unapproved change orders. COs saved before the approval flow existed
  // (no `requiresApproval` field stored — e.g. the old "Auto-added from
  // submission" ones) only carry the schema's default "Pending", never a real
  // decision, so they're left out. Needs raw (lean) docs, where a missing
  // field stays missing instead of being filled with the schema default.
  const unapproved = changeOrders
    .filter((co) => "requiresApproval" in co && (co.approval || "Pending") === "Pending")
    .sort(bySentDate)
    .map((co) => ({
      coNumber: co.coNumber,
      sent: date(co.date || co.createdAt),
      desc: [co.changeType, co.notes].filter(Boolean).join(" - "),
      days: daysSince(co.date || co.createdAt),
    }));

  // ── 4. BFA tracking — completed submissions with no BFA receipt date yet,
  // waiting more than BFA_WAIT_DAYS since they were marked completed (older
  // records without a completed date fall back to their submission date).
  const awaiting = records
    .filter((r) => COMPLETED_TAGS.has(r.tag) && !r.bfa_received_date)
    .map((r) => {
      // "Submitted" = the day it was completed. TR# isn't tracked, so it's left blank.
      const sentRaw = r.completed_at || r.sub_date_raw || r.due_date_raw;
      return { sent: date(sentRaw), desc: r.submission_name, days: daysSince(sentRaw) };
    })
    .filter((r) => r.days !== null && r.days > BFA_WAIT_DAYS)
    .sort((a, b) => a.sent - b.sent);

  return { header, rfiRows, upcoming, unapproved, awaiting, support };
}

/* ═════════════════════════════ Excel ═════════════════════════════ */

const LINK_FONT = { color: { argb: LINK_COLOR }, underline: true };

/**
 * The "Supportive Document" sheet — one block per multi-question RFI with
 * open questions. Returns each block's anchor cell (the Weekly Status
 * follow-up row links to it); each block links back to `backRefs[i]`.
 */
function writeSupportiveSheet(ws, support, backRefs) {
  ws.columns = [{ width: 8 }, { width: 70 }, { width: 16 }];
  const font = { name: "Calibri", size: 10 };

  const title = ws.getCell("A1");
  ws.mergeCells("A1:C1");
  title.value = "SUPPORTIVE DOCUMENT – RFI QUESTIONS AWAITING RESPONSE";
  title.font = { ...font, size: 12, bold: true };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_TITLE } };
  title.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 24;

  if (!support.length) {
    const empty = ws.getCell("A3");
    empty.value = "No RFIs with questions awaiting response.";
    empty.font = { ...font, italic: true, color: { argb: "FF808080" } };
    return [];
  }

  let row = 3;
  return support.map((block, i) => {
    const anchor = `A${row}`;

    ws.mergeCells(`A${row}:C${row}`);
    const head = ws.getCell(anchor);
    head.value = block.heading;
    head.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_SECTION } };
    row++;

    ws.mergeCells(`A${row}:C${row}`);
    const meta = ws.getCell(`A${row}`);
    meta.value = block.meta;
    meta.font = { ...font, italic: true };
    row++;

    ["Q#", "Question (awaiting response)", "Days awaited"].forEach((label, c) => {
      const cell = ws.getRow(row).getCell(c + 1);
      cell.value = label;
      cell.font = { ...font, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_COLHEAD } };
      cell.border = BOX;
      cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    });
    row++;

    for (const q of block.questions) {
      [q.label, q.text, q.days].forEach((v, c) => {
        const cell = ws.getRow(row).getCell(c + 1);
        if (v !== null && v !== undefined) cell.value = v;
        cell.font = font;
        cell.border = BOX;
        cell.alignment = { vertical: "top", wrapText: true, horizontal: c === 1 ? "left" : "center" };
      });
      row++;
    }

    ws.mergeCells(`A${row}:C${row}`);
    const back = ws.getCell(`A${row}`);
    back.value = { text: "← Back to Weekly Status", hyperlink: `#${backRefs[i]}` };
    back.font = { ...font, ...LINK_FONT };
    row += 2;
    return anchor;
  });
}

/** @param {ReturnType<typeof buildWeeklyStatusData>} data */
async function buildWeeklyStatusWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Weekly Status", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true },
    views: [{ showGridLines: false }],
  });
  ws.columns = COL_WIDTHS.map((width) => ({ width }));
  const supportWs = wb.addWorksheet(SUPPORT_SHEET, { views: [{ showGridLines: false }] });

  let row = 1;

  // Merge cols [from..to] on the current row, set value + style on the top-left cell, and box every cell.
  function put(from, to, value, style = {}) {
    const a = `${from}${row}`;
    if (from !== to) ws.mergeCells(`${a}:${to}${row}`);
    const cell = ws.getCell(a);
    if (value !== undefined && value !== null && value !== "") cell.value = value;
    if (style.numFmt) cell.numFmt = style.numFmt;
    cell.font = { name: "Calibri", size: 10, ...(style.font || {}) };
    cell.alignment = { vertical: "middle", wrapText: true, ...(style.alignment || {}) };
    for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) {
      const each = ws.getCell(`${String.fromCharCode(c)}${row}`);
      if (style.fill) each.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.fill } };
      each.border = style.border || BOX;
    }
    return cell;
  }

  function sectionHead({ title, cols }) {
    put("A", LAST_COL, title, { fill: FILL_SECTION, font: { bold: true, color: { argb: "FFFFFFFF" } } });
    row++;
    for (const [from, to, label, align] of cols) {
      put(from, to, label, { fill: FILL_COLHEAD, font: { bold: true }, alignment: align ? { horizontal: align } : {} });
    }
    row++;
  }

  const dateFmt = { numFmt: "d-mmm-yy", alignment: { horizontal: "right" } };
  const center = { alignment: { horizontal: "center" } };

  // ── Title + logo
  for (let r = row; r < row + 3; r++) ws.getRow(r).height = 22;
  ws.mergeCells(`A${row}:${LAST_COL}${row + 2}`);
  const title = ws.getCell(`A${row}`);
  title.value = "WEEKLY PROJECT STATUS";
  title.font = { name: "Calibri", size: 12, bold: true };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_TITLE } };
  title.border = { top: medium, left: medium, bottom: thin, right: medium };
  if (fs.existsSync(LOGO_PATH)) {
    const imageId = wb.addImage({ filename: LOGO_PATH, extension: "jpeg" });
    ws.addImage(imageId, { tl: { col: 5.15, row: row - 1 + 0.2 }, ext: { width: 230, height: 68 } });
  }
  row += 3;

  // ── Header block
  data.header.forEach(([label, value], i) => {
    const border = i === data.header.length - 1 ? { ...BOX, bottom: medium } : BOX;
    put("A", "B", label, { fill: FILL_VALUE, font: { bold: true }, border });
    put("C", LAST_COL, value, { fill: FILL_VALUE, border });
    row++;
  });

  // ── 1. Pending RFIs — follow-up link cells are filled in once the
  // Supportive Document sheet (and so each block's anchor) exists.
  sectionHead(SECTIONS.rfis);
  const followUps = []; // [{ cell, text }] indexed by supportIndex
  const backRefs = [];
  for (let i = 0; i < Math.max(MIN_ROWS.rfis, data.rfiRows.length); i++) {
    const r = data.rfiRows[i];
    if (r?.kind === "followUp") {
      put("A", "A", null);
      put("B", "B", null);
      followUps[r.supportIndex] = { cell: put("C", "E", null, { font: LINK_FONT }), text: `↳ ${r.text}` };
      backRefs[r.supportIndex] = `'${ws.name}'!A${row}`;
      put("F", "F", null);
      put("G", "H", null);
    } else {
      put("A", "A", r?.num, { alignment: { horizontal: "right" } });
      put("B", "B", r?.sent, dateFmt);
      put("C", "E", r?.title);
      put("F", "F", r?.due, dateFmt);
      put("G", "H", r?.impacted);
    }
    row++;
  }
  const anchors = writeSupportiveSheet(supportWs, data.support, backRefs);
  followUps.forEach(({ cell, text }, i) => {
    cell.value = { text, hyperlink: `#'${SUPPORT_SHEET}'!${anchors[i]}`, tooltip: "Open the unanswered questions" };
  });

  // ── 2. Upcoming planned submissions
  sectionHead(SECTIONS.upcoming);
  for (let i = 0; i < Math.max(MIN_ROWS.submissions, data.upcoming.length); i++) {
    const r = data.upcoming[i];
    put("A", "C", r?.name);
    put("D", "E", r?.planned, dateFmt);
    put("F", "F", r?.type);
    put("G", "H", r?.pendingRfi);
    row++;
  }

  // ── 3. Unapproved change orders
  sectionHead(SECTIONS.unapproved);
  for (let i = 0; i < Math.max(MIN_ROWS.changeOrders, data.unapproved.length); i++) {
    const co = data.unapproved[i];
    put("A", "A", co?.coNumber);
    put("B", "B", co?.sent, dateFmt);
    put("C", "F", !data.unapproved.length && i === 0 ? NO_CO_TEXT : co?.desc);
    put("G", "H", co?.days, center);
    row++;
  }

  // ── 4. BFA tracking
  sectionHead(SECTIONS.awaiting);
  for (let i = 0; i < Math.max(MIN_ROWS.bfa, data.awaiting.length); i++) {
    const r = data.awaiting[i];
    put("A", "A", null);
    put("B", "B", r?.sent, dateFmt);
    put("C", "G", r?.desc);
    put("H", "H", r?.days, center);
    row++;
  }

  // ── Key actions required from customer
  row++;
  const keyTitle = ws.getCell(`A${row}`);
  keyTitle.value = "KEY ACTIONS REQUIRED FROM CUSTOMER";
  keyTitle.font = { name: "Calibri", size: 10, bold: true };
  row++;
  for (let i = 0; i < MIN_ROWS.keyActions; i++) {
    put("A", LAST_COL, null);
    row++;
  }

  return wb;
}

/* ═════════════════════════════ PDF ═════════════════════════════ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "16-Sep-26" — same as the Excel d-mmm-yy format. */
function fmtShortDate(d) {
  return d ? `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}` : "";
}

const hex = (argb) => `#${argb.slice(2)}`;

/**
 * Renders the report as an A4 PDF, streamed into `out` (e.g. the response).
 * Same grid as the Excel sheet; the Supportive Document starts on a new page,
 * with internal links both ways.
 * @param {ReturnType<typeof buildWeeklyStatusData>} data
 */
function buildWeeklyStatusPdf(data, out) {
  const M = 28; // page margin (pt)
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: "Weekly Project Status" } });
  doc.pipe(out);

  const pageW = doc.page.width - 2 * M;
  const bottom = () => doc.page.height - M;
  const totalUnits = COL_WIDTHS.reduce((a, b) => a + b, 0);
  const colX = [M];
  COL_WIDTHS.forEach((w) => colX.push(colX[colX.length - 1] + (w / totalUnits) * pageW));
  const span = (from, to) => {
    const a = from.charCodeAt(0) - 65;
    const b = to.charCodeAt(0) - 65;
    return { x: colX[a], w: colX[b + 1] - colX[a] };
  };

  const FONT_SIZE = 8.5;
  const PAD = 2.5;
  let y = M;

  /**
   * Draws one table row. cells: [{ x, w, text, fill, bold, color, align, goTo, destination }].
   * Height grows to fit wrapped text; breaks to a new page first if it won't fit.
   */
  function drawRow(cells, { minH = 13, lineWidth = 0.5 } = {}) {
    doc.fontSize(FONT_SIZE);
    let h = minH;
    for (const c of cells) {
      if (c.text === "" || c.text == null) continue;
      doc.font(c.bold ? "Helvetica-Bold" : "Helvetica");
      h = Math.max(h, doc.heightOfString(String(c.text), { width: c.w - 2 * PAD }) + 2 * PAD);
    }
    if (y + h > bottom()) {
      doc.addPage();
      y = M;
    }
    for (const c of cells) {
      if (c.fill) doc.rect(c.x, y, c.w, h).fill(hex(c.fill));
      doc.lineWidth(lineWidth).rect(c.x, y, c.w, h).stroke("#000000");
      if (c.text !== "" && c.text != null) {
        const text = String(c.text);
        doc.font(c.bold ? "Helvetica-Bold" : "Helvetica").fillColor(c.color || "#000000");
        const th = doc.heightOfString(text, { width: c.w - 2 * PAD });
        doc.text(text, c.x + PAD, y + (h - th) / 2, { width: c.w - 2 * PAD, align: c.align || "left", underline: !!c.goTo });
        if (c.goTo) doc.goTo(c.x, y, c.w, h, c.goTo);
      }
      if (c.destination) doc.addNamedDestination(c.destination, "XYZ", 0, y, null);
    }
    doc.fillColor("#000000");
    y += h;
  }

  const cell = (from, to, text, opts = {}) => ({ ...span(from, to), text, ...opts });

  function sectionHead({ title, cols }) {
    // Keep the section bar + column heads + at least one row together.
    if (y + 15 * 3 > bottom()) {
      doc.addPage();
      y = M;
    }
    drawRow([cell("A", LAST_COL, title, { fill: FILL_SECTION, bold: true, color: "#FFFFFF" })]);
    drawRow(cols.map(([from, to, label, align]) => cell(from, to, label, { fill: FILL_COLHEAD, bold: true, align })));
  }

  // ── Title band + logo
  const titleH = 54;
  doc.rect(M, y, pageW, titleH).fill(hex(FILL_TITLE));
  doc.lineWidth(1.2).rect(M, y, pageW, titleH).stroke("#000000");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000").text("WEEKLY PROJECT STATUS", M + 10, y + titleH / 2 - 6);
  if (fs.existsSync(LOGO_PATH)) {
    const logoH = titleH - 12;
    const logoW = logoH * (572 / 168);
    doc.image(LOGO_PATH, M + pageW - logoW - 8, y + 6, { width: logoW, height: logoH });
  }
  y += titleH;

  // ── Header block
  data.header.forEach(([label, value], i) => {
    drawRow(
      [cell("A", "B", label, { fill: FILL_VALUE, bold: true }), cell("C", LAST_COL, value, { fill: FILL_VALUE })],
      { lineWidth: i === data.header.length - 1 ? 1.2 : 0.5 }
    );
  });

  // ── 1. Pending RFIs
  sectionHead(SECTIONS.rfis);
  for (let i = 0; i < Math.max(MIN_ROWS.rfis, data.rfiRows.length); i++) {
    const r = data.rfiRows[i];
    if (r?.kind === "followUp") {
      drawRow([
        cell("A", "A", ""),
        cell("B", "B", ""),
        cell("C", "E", `» ${r.text}`, { color: hex(LINK_COLOR), goTo: `support-${r.supportIndex}`, destination: `rfi-row-${r.supportIndex}` }),
        cell("F", "F", ""),
        cell("G", "H", ""),
      ]);
    } else {
      drawRow([
        cell("A", "A", r?.num, { align: "right" }),
        cell("B", "B", fmtShortDate(r?.sent), { align: "right" }),
        cell("C", "E", r?.title),
        cell("F", "F", fmtShortDate(r?.due), { align: "right" }),
        cell("G", "H", r?.impacted),
      ]);
    }
  }

  // ── 2. Upcoming planned submissions
  sectionHead(SECTIONS.upcoming);
  for (let i = 0; i < Math.max(MIN_ROWS.submissions, data.upcoming.length); i++) {
    const r = data.upcoming[i];
    drawRow([
      cell("A", "C", r?.name),
      cell("D", "E", fmtShortDate(r?.planned), { align: "right" }),
      cell("F", "F", r?.type),
      cell("G", "H", r?.pendingRfi),
    ]);
  }

  // ── 3. Unapproved change orders
  sectionHead(SECTIONS.unapproved);
  for (let i = 0; i < Math.max(MIN_ROWS.changeOrders, data.unapproved.length); i++) {
    const co = data.unapproved[i];
    drawRow([
      cell("A", "A", co?.coNumber),
      cell("B", "B", fmtShortDate(co?.sent), { align: "right" }),
      cell("C", "F", !data.unapproved.length && i === 0 ? NO_CO_TEXT : co?.desc),
      cell("G", "H", co?.days, { align: "center" }),
    ]);
  }

  // ── 4. BFA / IFA tracking
  sectionHead(SECTIONS.awaiting);
  for (let i = 0; i < Math.max(MIN_ROWS.bfa, data.awaiting.length); i++) {
    const r = data.awaiting[i];
    drawRow([
      cell("A", "A", ""),
      cell("B", "B", fmtShortDate(r?.sent), { align: "right" }),
      cell("C", "G", r?.desc),
      cell("H", "H", r?.days, { align: "center" }),
    ]);
  }

  // ── Key actions required from customer
  // The blank fill-in lines shrink to whatever space is left on the page
  // (at least 3) so the report doesn't spill onto a page of empty lines.
  const LINE_H = 13;
  y += 12;
  let keyLines = Math.min(MIN_ROWS.keyActions, Math.floor((bottom() - y - 14) / LINE_H));
  if (keyLines < 3) {
    doc.addPage();
    y = M;
    keyLines = MIN_ROWS.keyActions;
  }
  doc.font("Helvetica-Bold").fontSize(FONT_SIZE + 0.5).fillColor("#000000").text("KEY ACTIONS REQUIRED FROM CUSTOMER", M, y);
  y += 14;
  for (let i = 0; i < keyLines; i++) drawRow([cell("A", LAST_COL, "")], { minH: LINE_H });

  // ── Supportive Document (new page)
  doc.addPage();
  y = M;
  const sx = [M, M + pageW * 0.08, M + pageW * 0.86, M + pageW];
  const scell = (i, text, opts = {}) => ({ x: sx[i], w: sx[i + 1] - sx[i], text, ...opts });
  const full = (text, opts = {}) => ({ x: M, w: pageW, text, ...opts });

  drawRow([full("SUPPORTIVE DOCUMENT – RFI QUESTIONS AWAITING RESPONSE", { fill: FILL_TITLE, bold: true })], { minH: 22 });
  y += 10;
  if (!data.support.length) {
    doc.font("Helvetica-Oblique").fontSize(FONT_SIZE).fillColor("#808080").text("No RFIs with questions awaiting response.", M, y);
  }
  data.support.forEach((block, i) => {
    if (y + 15 * 4 > bottom()) {
      doc.addPage();
      y = M;
    }
    drawRow([full(block.heading, { fill: FILL_SECTION, bold: true, color: "#FFFFFF", destination: `support-${i}` })]);
    drawRow([full(block.meta)]);
    drawRow([
      scell(0, "Q#", { fill: FILL_COLHEAD, bold: true, align: "center" }),
      scell(1, "Question (awaiting response)", { fill: FILL_COLHEAD, bold: true }),
      scell(2, "Days awaited", { fill: FILL_COLHEAD, bold: true, align: "center" }),
    ]);
    for (const q of block.questions) {
      drawRow([scell(0, q.label, { align: "center" }), scell(1, q.text), scell(2, q.days, { align: "center" })]);
    }
    const linkY = y + 4;
    doc.font("Helvetica").fontSize(FONT_SIZE).fillColor(hex(LINK_COLOR));
    doc.text("« Back to Weekly Status", M, linkY, { underline: true });
    doc.goTo(M, linkY, doc.widthOfString("« Back to Weekly Status"), 12, `rfi-row-${i}`);
    doc.fillColor("#000000");
    y = linkY + 24;
  });

  doc.end();
}

module.exports = { buildWeeklyStatusData, buildWeeklyStatusWorkbook, buildWeeklyStatusPdf };
