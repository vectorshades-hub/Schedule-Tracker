import { API_URL } from "./api";
import { resolveMarkStyle } from "../components/RfiMarkStylePanel";

// Mark geometry shared by the Mark Up workspace (SVG on screen) and the PDF
// export below, so a downloaded markup matches what was drawn.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A mark's effective style. Marks saved before styles existed have none —
 * they keep the original side-of-label → nearest-point line rather than
 * jumping to the newer center-to-center default. */
export function markStyle(mark) {
  return mark.style ? resolveMarkStyle(mark.style) : resolveMarkStyle({ labelSide: "auto", boxAnchor: "nearest" });
}

/** Where the leader line meets the box (px), per the style's boxAnchor; null when it'd be hidden inside the box. */
export function boxAnchorPoint(anchor, x, y, w, h, lx, ly) {
  switch (anchor) {
    case "top":
      return [x + w / 2, y];
    case "right":
      return [x + w, y + h / 2];
    case "bottom":
      return [x + w / 2, y + h];
    case "left":
      return [x, y + h / 2];
    case "center":
      return [x + w / 2, y + h / 2];
    case "edge-center": {
      // On the box border, along the line from the box's center to (lx, ly).
      const cx = x + w / 2;
      const cy = y + h / 2;
      const dx = lx - cx;
      const dy = ly - cy;
      const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
      return t >= 1 ? null : [cx + dx * t, cy + dy * t];
    }
    default: {
      const ex = clamp(lx, x, x + w);
      const ey = clamp(ly, y, y + h);
      return ex === lx && ey === ly ? null : [ex, ey];
    }
  }
}

/**
 * SVG path for a revision-cloud border around a rectangle: a run of scallop
 * arcs along each edge. The rectangle is walked clockwise, so sweep-flag 1
 * makes every arc bulge outward. A radius a bit larger than half the segment
 * keeps the scallops shallower than full semicircles.
 */
export function cloudPath(x, y, w, h, scallop) {
  const pts = [];
  const edge = (x1, y1, x2, y2) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / (scallop * 2)));
    for (let i = 1; i <= n; i++) pts.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]);
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
  let d = `M${x},${y}`;
  let prev = [x, y];
  for (const p of pts) {
    const r = (Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 2) * 1.15;
    d += ` A${r},${r} 0 0 1 ${p[0]},${p[1]}`;
    prev = p;
  }
  return `${d} Z`;
}

/** Ids of the marks that get the full "Qn: text" label — each question's first in reading order. */
export function fullLabelMarkIds(marks) {
  const first = new Map();
  for (const m of marks) {
    const cur = first.get(m.question_id);
    if (!cur || m.page < cur.page || (m.page === cur.page && (m.y < cur.y || (m.y === cur.y && m.x < cur.x)))) {
      first.set(m.question_id, m);
    }
  }
  return new Set([...first.values()].map((m) => m.id));
}

/** The leader line's geometry for a mark on a w×h px page: label anchor, optional bend, box end (null = no line). */
export function leaderLine(m, s, pw, ph) {
  const x = m.x * pw;
  const y = m.y * ph;
  const w = m.w * pw;
  const h = m.h * ph;
  const label = [m.label_x * pw, m.label_y * ph];
  const bend = m.line_bend_x != null ? [m.line_bend_x * pw, m.line_bend_y * ph] : null;
  const from = bend || label;
  const end =
    s.lineStyle === "none"
      ? null
      : m.line_end_x != null
      ? [x + m.line_end_x * w, y + m.line_end_y * h]
      : boxAnchorPoint(s.boxAnchor, x, y, w, h, from[0], from[1]);
  return { label, bend, from, end };
}

/** Which side of the label the line leaves from (resolves "auto" to the side facing the box). */
export const labelSideOf = (m, s) => (s.labelSide !== "auto" ? s.labelSide : m.label_x < m.x + m.w / 2 ? "right" : "left");

// ---------------------------------------------------------------------------
// PDF export — the uploaded PDF with its marks, labels and placed images
// drawn into the pages (pdf-lib, loaded on demand).
// ---------------------------------------------------------------------------

let pdfLibPromise = null;
const loadPdfLib = () => (pdfLibPromise ||= import("pdf-lib"));

function hexColor(rgb, hex) {
  const n = parseInt(String(hex || "#000000").slice(1), 16) || 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function fetchBytes(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Couldn't download ${url.split("/").pop()} (${res.status})`);
  return res;
}

/** Embeds a placed image; GIF/WebP aren't supported by pdf-lib, so they're re-encoded to PNG via a canvas. */
async function embedImage(pdfDoc, res) {
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return pdfDoc.embedPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return pdfDoc.embedJpg(bytes);
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return pdfDoc.embedPng(new Uint8Array(await png.arrayBuffer()));
}

/** Text the standard (WinAnsi) fonts can draw — anything else becomes "?". */
function encodable(font, text) {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return [...text]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return "?";
        }
      })
      .join("");
  }
}

/** Greedy word-wrap of [{text, font}] runs into lines no wider than maxW (Infinity = one line). */
function wrapRuns(runs, size, maxW) {
  const words = [];
  for (const r of runs) {
    r.text.split(/(\s+)/).forEach((part, i) => {
      if (!part) return;
      if (/^\s+$/.test(part)) words.push({ space: true, font: r.font });
      else words.push({ text: part, font: r.font, glue: i === 0 && words.length > 0 && !words[words.length - 1].space });
    });
  }
  const lines = [[]];
  let lineW = 0;
  let pendingSpace = null;
  for (const w of words) {
    if (w.space) {
      pendingSpace = w;
      continue;
    }
    const wordW = w.font.widthOfTextAtSize(w.text, size);
    const spaceW = pendingSpace && lineW > 0 ? pendingSpace.font.widthOfTextAtSize(" ", size) : 0;
    if (lineW > 0 && !w.glue && lineW + spaceW + wordW > maxW) {
      lines.push([]);
      lineW = 0;
    } else if (spaceW) {
      lines[lines.length - 1].push({ text: " ", font: pendingSpace.font, w: spaceW });
      lineW += spaceW;
    }
    lines[lines.length - 1].push({ text: w.text, font: w.font, w: wordW });
    lineW += wordW;
    pendingSpace = null;
  }
  return lines.map((segs) => ({ segs, w: segs.reduce((a, s) => a + s.w, 0) }));
}

/** Rounded-rectangle SVG path (y-down px). */
function roundRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

/**
 * Maps the page as pdf.js shows it (crop box, /Rotate applied; origin
 * bottom-left, y up) onto the page's own user space, so everything below can
 * draw in the same coordinates the workspace saved fractions against.
 */
function viewMatrix(page) {
  const { x, y, width: w, height: h } = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  if (rot === 90) return { m: [0, 1, -1, 0, x + w, y], W: h, H: w };
  if (rot === 180) return { m: [-1, 0, 0, -1, x + w, y + h], W: w, H: h };
  if (rot === 270) return { m: [0, -1, 1, 0, x, y + h], W: h, H: w };
  return { m: [1, 0, 0, 1, x, y], W: w, H: h };
}

/** Draws one markup doc's marks, labels and images into its loaded pdf-lib document. */
async function annotateDoc(lib, pdfDoc, { rfiId, doc, questions }) {
  const { rgb, StandardFonts, LineCapStyle, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = lib;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const qIndex = new Map(questions.map((q, i) => [q.id, { q, num: i + 1 }]));
  const fullIds = fullLabelMarkIds(doc.marks || []);
  const pages = pdfDoc.getPages();

  const imageCache = new Map();
  const getImage = (filename) => {
    if (!imageCache.has(filename)) {
      imageCache.set(
        filename,
        fetchBytes(`${API_URL}/rfis/${rfiId}/markups/${doc.id}/images/${encodeURIComponent(filename)}`).then((res) =>
          embedImage(pdfDoc, res)
        )
      );
    }
    return imageCache.get(filename);
  };

  for (let pi = 0; pi < pages.length; pi++) {
    const pageNo = pi + 1;
    const marks = (doc.marks || []).filter((m) => m.page === pageNo);
    const imgs = (doc.images || []).filter((im) => im.page === pageNo);
    if (!marks.length && !imgs.length) continue;

    const page = pages[pi];
    const { m: cm, W, H } = viewMatrix(page);
    const unit = W / 1000; // style sizes are px at a 1000px-wide page (see RfiMarkStylePanel)
    const svg = (d, opts) => page.drawSvgPath(d, { x: 0, y: H, ...opts }); // paths are y-down from the top-left

    // Isolate the original content's graphics state, then draw in view space.
    page.node.normalize();
    const ctx = pdfDoc.context;
    page.node.wrapContentStreams(
      ctx.register(ctx.contentStream([pushGraphicsState()])),
      ctx.register(ctx.contentStream([popGraphicsState()]))
    );
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...cm));

    const drawImages = async (list) => {
      for (const im of list) {
        try {
          const img = await getImage(im.filename);
          page.drawImage(img, { x: im.x * W, y: H - (im.y + im.h) * H, width: im.w * W, height: im.h * H });
        } catch (e) {
          console.error("[markup export] image skipped:", e);
        }
      }
    };

    // Same stacking as the workspace: locked images under the marks, unlocked ones over them, labels on top.
    await drawImages(imgs.filter((im) => im.locked));

    for (const m of marks) {
      const s = markStyle(m);
      const x = m.x * W;
      const y = m.y * H;
      const w = m.w * W;
      const h = m.h * H;
      const borderW = s.borderWidth * unit;
      const box = {
        color: hexColor(rgb, s.fillColor),
        opacity: s.fillOpacity,
        borderColor: hexColor(rgb, s.borderColor),
        borderWidth: borderW,
      };
      if (s.borderStyle === "cloud") {
        svg(cloudPath(x, y, w, h, Math.min(s.cloudSize * unit, Math.max(2, Math.min(w, h) / 3))), box);
      } else {
        svg(`M${x},${y} H${x + w} V${y + h} H${x} Z`, {
          ...box,
          borderDashArray: s.borderStyle === "dashed" ? [borderW * 4, borderW * 2.5] : undefined,
        });
      }

      const { label, bend, from, end } = leaderLine(m, s, W, H);
      if (!end) continue;
      const lineW = s.lineWidth * unit;
      const lineColor = hexColor(rgb, s.lineColor);
      const pts = [label, ...(bend ? [bend] : []), end];
      svg(`M${pts.map((p) => p.join(",")).join(" L")}`, {
        borderColor: lineColor,
        borderWidth: lineW,
        borderLineCap: LineCapStyle.Round,
        borderDashArray:
          s.lineStyle === "dashed" ? [lineW * 5, lineW * 3] : s.lineStyle === "dotted" ? [0, lineW * 2.5] : undefined,
      });
      if (s.lineEnd === "dot") {
        page.drawCircle({ x: end[0], y: H - end[1], size: Math.max(2 * unit, lineW * 1.8), color: lineColor });
      } else if (s.lineEnd === "arrow") {
        const a = Math.atan2(end[1] - from[1], end[0] - from[0]);
        const len = Math.max(6 * unit, lineW * 5);
        const pt = (da) => `${end[0] - len * Math.cos(a + da)},${end[1] - len * Math.sin(a + da)}`;
        svg(`M${end[0]},${end[1]} L${pt(0.45)} L${pt(-0.45)} Z`, { color: lineColor });
      }
    }

    await drawImages(imgs.filter((im) => !im.locked));

    // Callout labels — laid out like .rfi-mk-label: bold "Qn", wrapped at 22em when it carries the question text.
    for (const m of marks) {
      const s = markStyle(m);
      const info = qIndex.get(m.question_id);
      const full = fullIds.has(m.id) && info;
      const size = Math.max(4 * unit, s.fontSize * unit);
      const padX = size * 0.58;
      const padY = size * 0.17;
      const bw = Math.max(0.5, s.lineWidth * unit);
      const lineH = size * 1.3;
      const runs = [{ text: encodable(bold, info ? `Q${info.num}` : "Q?"), font: bold }];
      if (full) runs.push({ text: encodable(font, `: ${info.q.text}`), font });
      const lines = wrapRuns(runs, size, full ? 22 * size - 2 * (padX + bw) : Infinity);
      const bw2 = Math.max(...lines.map((l) => l.w)) + 2 * (padX + bw);
      const bh = lines.length * lineH + 2 * (padY + bw);

      const [ax, ay] = [m.label_x * W, m.label_y * H];
      const side = labelSideOf(m, s);
      const left = side === "left" ? ax : side === "right" ? ax - bw2 : ax - bw2 / 2;
      const top = side === "top" ? ay : side === "bottom" ? ay - bh : ay - bh / 2;

      svg(roundRectPath(left + bw / 2, top + bw / 2, bw2 - bw, bh - bw, size * 0.33), {
        color: hexColor(rgb, s.labelBg),
        borderColor: hexColor(rgb, s.lineStyle === "none" ? s.borderColor : s.lineColor),
        borderWidth: bw,
      });
      const textColor = hexColor(rgb, s.textColor);
      lines.forEach((line, li) => {
        let tx = left + bw + padX;
        // Baseline: glyphs centered in the line box (Helvetica's ascent/descent ≈ 0.718/0.207 of the size).
        const baseline = top + bw + padY + li * lineH + (lineH - size * 0.925) / 2 + size * 0.718;
        for (const seg of line.segs) {
          page.drawText(seg.text, { x: tx, y: H - baseline, size, font: seg.font, color: textColor });
          tx += seg.w;
        }
      });
    }

    page.pushOperators(popGraphicsState());
  }
}

/**
 * Inserts Letter-size page(s) at the front of `pdfDoc` with the intro line and
 * the RFI's numbered questions (same wording as the copied email). Long lists
 * flow onto further pages.
 */
async function addQuestionsPages(lib, pdfDoc, questions) {
  const { rgb, StandardFonts } = lib;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const [PW, PH] = [612, 792];
  const margin = 54;
  const size = 11;
  const lineH = size * 1.45;
  const indent = 22;
  const color = rgb(0.1, 0.1, 0.18);

  let pageIdx = 0;
  let page = pdfDoc.insertPage(pageIdx, [PW, PH]);
  let y = PH - margin;
  const ensureRoom = () => {
    if (y - lineH >= margin) return;
    page = pdfDoc.insertPage(++pageIdx, [PW, PH]);
    y = PH - margin;
  };

  const intro = encodable(bold, "Please see the below clarification questions and respond asap.");
  for (const line of wrapRuns([{ text: intro, font: bold }], size + 1, PW - 2 * margin)) {
    ensureRoom();
    y -= lineH;
    page.drawText(line.segs.map((s) => s.text).join(""), { x: margin, y, size: size + 1, font: bold, color });
  }
  y -= lineH * 0.6;

  const texts = questions.map((q) => (q.text || "").trim()).filter(Boolean);
  texts.forEach((text, i) => {
    const lines = wrapRuns([{ text: encodable(font, text.replace(/\s*\n\s*/g, " ")), font }], size, PW - 2 * margin - indent);
    lines.forEach((line, li) => {
      ensureRoom();
      y -= lineH;
      if (li === 0) page.drawText(`${i + 1}.`, { x: margin, y, size, font: bold, color });
      page.drawText(line.segs.map((s) => s.text).join(""), { x: margin + indent, y, size, font, color });
    });
    y -= lineH * 0.35;
  });
}

/** Downloads a Blob as `filename`. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "RFI";

/**
 * Builds and downloads the marked-up PDF for an RFI: each of `docs` (from
 * GET /rfis/:id/markups) with its marks drawn in; several docs are combined
 * into one file, in order, behind a front page listing the RFI's questions.
 */
export async function downloadRfiMarkup(rfi, docs) {
  if (!docs?.length) throw new Error("This RFI has no marked-up PDFs.");
  const lib = await loadPdfLib();
  const questions = rfi.questions || [];
  const annotated = [];
  for (const doc of docs) {
    const res = await fetchBytes(`${API_URL}/rfis/${rfi.id}/markups/${doc.id}/file`);
    const pdfDoc = await lib.PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true });
    await annotateDoc(lib, pdfDoc, { rfiId: rfi.id, doc, questions });
    annotated.push(pdfDoc);
  }

  let out = annotated[0];
  if (annotated.length > 1) {
    out = await lib.PDFDocument.create();
    for (const d of annotated) (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p));
  }
  if (questions.some((q) => (q.text || "").trim())) await addQuestionsPages(lib, out, questions);
  const bytes = await out.save();
  const base = safeName([rfi.rfi_number, rfi.title].filter(Boolean).join(" - "));
  const name = docs.length === 1 ? `${base} - ${safeName(docs[0].original_name.replace(/\.pdf$/i, ""))}` : base;
  saveBlob(new Blob([bytes], { type: "application/pdf" }), `${name} (markup).pdf`);
}
