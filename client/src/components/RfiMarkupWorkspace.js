"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "../lib/api";
import { useToast } from "../lib/ToastContext";
import RfiMarkStylePanel, { DEFAULT_MARK_STYLE, resolveMarkStyle } from "./RfiMarkStylePanel";
import { boxAnchorPoint, cloudPath, downloadRfiMarkup, fullLabelMarkIds, markStyle } from "../lib/rfiMarkupExport";

const DEFAULT_STYLE_KEY = "rfiMarkupDefaultStyle.v2";
const LEGACY_DEFAULT_STYLE_KEY = "rfiMarkupDefaultStyle"; // v1: line ran from the label's side to the nearest box point
function loadDefaultStyle() {
  try {
    const saved = localStorage.getItem(DEFAULT_STYLE_KEY);
    if (saved) return resolveMarkStyle(JSON.parse(saved));
    // Keep a v1 default's colors/sizes, but move it onto the center-to-center line.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_DEFAULT_STYLE_KEY) || "null");
    if (!legacy) return { ...DEFAULT_MARK_STYLE };
    const { labelSide, boxAnchor, ...rest } = legacy;
    return resolveMarkStyle(rest);
  } catch {
    return { ...DEFAULT_MARK_STYLE };
  }
}
function storeDefaultStyle(style) {
  try {
    localStorage.setItem(DEFAULT_STYLE_KEY, JSON.stringify(style));
  } catch {
    // storage unavailable (private window etc.) — the default just won't persist
  }
}

// Which side of the label the line leaves from → how the label sits around its anchor point.
// "center" puts the anchor at the label's middle; the label (drawn above the
// SVG, opaque) hides the part of the line under it, so it appears to start at its edge.
const LABEL_TRANSFORM = {
  center: "translate(-50%, -50%)",
  left: "translate(0, -50%)",
  right: "translate(-100%, -50%)",
  top: "translate(-50%, 0)",
  bottom: "translate(-50%, -100%)",
};

// pdf.js is loaded lazily (it's large and only needed once someone opens a
// markup), and only in the browser — it touches window/canvas at import time.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const SAVE_DEBOUNCE_MS = 500;
const MIN_BOX_PX = 8; // smaller drags count as a click, not a new mark

const MIN_IMAGE_PX = 12;
const IMAGE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const newMarkId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(36).slice(2)}`;

const isImageFile = (f) => /^image\/(png|jpe?g|gif|webp)$/i.test(f.type || "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name || "");

/** An image file's natural pixel size. */
function imageNaturalSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("couldn't read the image"));
    };
    img.src = url;
  });
}

/**
 * Default callout position for a new mark: beside the cloud — right if
 * there's room, else left — vertically centered on it. For centered labels
 * (labelSide "center") the anchor is the label's middle, so it's pushed out
 * by an estimate of half the label's width (sizes are 1000px-page units;
 * a full label wraps at 22em, see .rfi-mk-label) to clear the cloud.
 */
function defaultLabelPos(box, style, labelChars) {
  const gap = 0.03;
  const halfW =
    style.labelSide === "center" ? Math.min(labelChars * 0.55 * style.fontSize, 22 * style.fontSize) / 2 / 1000 + 0.01 : 0;
  const rightX = box.x + box.w + gap + halfW;
  const roomRight = rightX + halfW < 1 || box.x - gap - halfW * 2 < 0;
  return {
    label_x: clamp(roomRight ? rightX : box.x - gap - halfW, 0, 1),
    label_y: clamp(box.y + box.h / 2, 0, 1),
  };
}

/**
 * Full-screen "Mark Up" workspace opened from RfiDetailsModal: upload PDFs
 * against the RFI, then tie regions of their pages to the RFI's questions
 * with red revision clouds and leader-lined callout labels. Each question's
 * first mark (reading order: page, then top-to-bottom) gets the full
 * "Q1: question text" label; later marks — e.g. an answer continuing on the
 * next page — get just "Q1". Marks autosave (see rfis.js's markup routes).
 */
export default function RfiMarkupWorkspace({ open, onClose, rfi, canEdit }) {
  const toast = useToast();
  const qc = useQueryClient();

  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activeDocId, setActiveDocId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [pdf, setPdf] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 }); // rendered CSS px at current scale

  const [marks, setMarks] = useState([]);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [activeQuestionId, setActiveQuestionId] = useState(null);
  const [selectedMarkId, setSelectedMarkId] = useState(null);
  const [scrollTargetId, setScrollTargetId] = useState(null);
  const [tool, setTool] = useState("box"); // box | text
  const [drawing, setDrawing] = useState(null); // {x0,y0,x1,y1} in page px while dragging a new box
  const [defaultStyle, setDefaultStyle] = useState(DEFAULT_MARK_STYLE); // style given to new marks
  const [styleOpen, setStyleOpen] = useState(true);
  // Images pasted/dropped onto pages: {id, filename, page, x, y, w, h, locked}, coords as 0–1 page fractions.
  const [images, setImages] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [placingImage, setPlacingImage] = useState(false);
  const [viewerDragOver, setViewerDragOver] = useState(false);
  const [appending, setAppending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pdfVersion, setPdfVersion] = useState(0); // bumped to reload the active PDF after pages are added

  useEffect(() => setDefaultStyle(loadDefaultStyle()), []);

  const fileInputRef = useRef(null);
  const appendInputRef = useRef(null);
  const keepPageRef = useRef(false); // set when reloading after "Add pages", so the view stays put
  const viewerRef = useRef(null);
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const renderTaskRef = useRef(null);
  const fitPendingRef = useRef(false);
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(null); // {docId, marks} not yet sent
  const labelDragRef = useRef(null);
  const lineDragRef = useRef(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const imageFileInputRef = useRef(null);
  const imageDragRef = useRef(null);
  const activeDocIdRef = useRef(activeDocId);
  activeDocIdRef.current = activeDocId;
  const placeImagesRef = useRef(null);

  const questions = useMemo(() => rfi?.questions || [], [rfi?.questions]);
  const questionIndex = useMemo(() => {
    const m = new Map();
    questions.forEach((q, i) => m.set(q.id, { q, num: i + 1 }));
    return m;
  }, [questions]);
  const activeDoc = docs.find((d) => d.id === activeDocId) || null;

  // ---- saving -------------------------------------------------------------

  const flushSave = useCallback(async () => {
    clearTimeout(saveTimerRef.current);
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    setSaveState("saving");
    try {
      await api.put(`/rfis/${rfi.id}/markups/${pending.docId}/marks`, { marks: pending.marks, images: pending.images });
      setSaveState(pendingSaveRef.current ? "saving" : "saved");
    } catch (e) {
      setSaveState("error");
      toast.error(`Couldn't save markup: ${e.message}`);
    }
  }, [rfi?.id, toast]);

  /** Schedules an autosave of the active doc's current marks and images. */
  const scheduleSave = useCallback(() => {
    const nextMarks = marksRef.current;
    const nextImages = imagesRef.current;
    // Mirrored into docs too, so switching tabs and back shows unsaved edits.
    setDocs((ds) => ds.map((d) => (d.id === activeDocId ? { ...d, marks: nextMarks, images: nextImages } : d)));
    pendingSaveRef.current = { docId: activeDocId, marks: nextMarks, images: nextImages };
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    setSaveState("saving");
  }, [activeDocId, flushSave]);

  /** Applies a change to the active doc's marks and schedules an autosave. */
  const updateMarks = useCallback(
    (updater) => {
      const next = updater(marksRef.current);
      marksRef.current = next;
      setMarks(next);
      scheduleSave();
    },
    [scheduleSave]
  );

  /** Same as updateMarks, for the active doc's placed images. */
  const updateImages = useCallback(
    (updater) => {
      const next = updater(imagesRef.current);
      imagesRef.current = next;
      setImages(next);
      scheduleSave();
    },
    [scheduleSave]
  );

  // ---- docs list ----------------------------------------------------------

  useEffect(() => {
    if (!open || !rfi) return;
    let cancelled = false;
    setDocsLoading(true);
    api
      .get(`/rfis/${rfi.id}/markups`)
      .then((res) => {
        if (cancelled) return;
        setDocs(res.docs || []);
        setActiveDocId((cur) => cur || res.docs?.[0]?.id || null);
      })
      .catch((e) => !cancelled && toast.error(e.message))
      .finally(() => !cancelled && setDocsLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rfi?.id]);

  useEffect(() => {
    if (open) return;
    setDocs([]);
    setActiveDocId(null);
    setSelectedMarkId(null);
    setSelectedImageId(null);
    setActiveQuestionId(null);
  }, [open]);

  async function uploadFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const imgs = files.filter((f) => !pdfs.includes(f) && isImageFile(f));
    if (imgs.length && !pdfs.length && pdf) return placeImages(imgs, null); // images go onto the open page
    if (pdfs.length + (pdf ? imgs.length : 0) < files.length) toast.error("Only PDF files can be marked up — other files were skipped.");
    if (!pdfs.length) return;
    setUploading(true);
    try {
      let lastId = null;
      for (const f of pdfs) {
        const fd = new FormData();
        fd.append("pdf", f);
        const res = await api.post(`/rfis/${rfi.id}/markups`, fd);
        setDocs((ds) => [...ds, res.doc]);
        lastId = res.doc.id;
      }
      await switchDoc(lastId);
      qc.invalidateQueries({ queryKey: ["rfis"] });
      toast.success(pdfs.length > 1 ? `${pdfs.length} PDFs uploaded.` : "PDF uploaded.");
    } catch (e) {
      toast.error(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Appends the picked PDFs' pages to the end of the open PDF (server merges them into one file). */
  async function appendPages(fileList) {
    const files = [...(fileList || [])].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (appendInputRef.current) appendInputRef.current.value = "";
    if (!files.length || !activeDocId) return;
    const docId = activeDocId;
    setAppending(true);
    try {
      await flushSave();
      let added = 0;
      for (const f of files) {
        const fd = new FormData();
        fd.append("pdf", f);
        const res = await api.post(`/rfis/${rfi.id}/markups/${docId}/append`, fd);
        added += res.added_pages || 0;
      }
      keepPageRef.current = true;
      setPdfVersion((v) => v + 1);
      toast.success(`${added} page${added === 1 ? "" : "s"} added to the end of this PDF.`);
    } catch (e) {
      toast.error(`Couldn't add pages: ${e.message}`);
    } finally {
      setAppending(false);
    }
  }

  async function downloadActive() {
    if (!activeDoc) return;
    setDownloading(true);
    try {
      await flushSave();
      await downloadRfiMarkup(rfi, [{ ...activeDoc, marks: marksRef.current, images: imagesRef.current }]);
    } catch (e) {
      toast.error(`Download failed: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  }

  async function switchDoc(id) {
    if (id === activeDocId) return;
    await flushSave();
    setActiveDocId(id);
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Remove "${doc.original_name}" and all of its marks?`)) return;
    if (pendingSaveRef.current?.docId === doc.id) {
      clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = null;
    }
    try {
      await api.delete(`/rfis/${rfi.id}/markups/${doc.id}`);
      const remaining = docs.filter((d) => d.id !== doc.id);
      setDocs(remaining);
      if (activeDocId === doc.id) setActiveDocId(remaining[0]?.id || null);
      qc.invalidateQueries({ queryKey: ["rfis"] });
    } catch (e) {
      toast.error(e.message);
    }
  }

  // ---- PDF loading & rendering ---------------------------------------------

  // Marks are owned locally while a doc is active; reset them when it changes.
  useEffect(() => {
    setMarks(activeDoc?.marks || []);
    setImages(activeDoc?.images || []);
    setSelectedMarkId(null);
    setSelectedImageId(null);
    setSaveState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId]);

  useEffect(() => {
    if (!open || !activeDocId) {
      setPdf(null);
      return;
    }
    let cancelled = false;
    let loaded = null;
    const keepPage = keepPageRef.current;
    keepPageRef.current = false;
    setPdfLoading(true);
    setPdfError("");
    if (!keepPage) setPdf(null);
    (async () => {
      try {
        const [pdfjs, res] = await Promise.all([
          loadPdfjs(),
          fetch(`${API_URL}/rfis/${rfi.id}/markups/${activeDocId}/file`, { credentials: "include" }),
        ]);
        if (!res.ok) throw new Error(`Couldn't load the PDF (${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer());
        loaded = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return loaded.destroy();
        if (!keepPage) {
          fitPendingRef.current = true;
          setPageNum(1);
        }
        setPdf(loaded);
      } catch (e) {
        if (!cancelled) setPdfError(e.message || "Couldn't open this PDF.");
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) loaded.destroy();
    };
  }, [open, activeDocId, rfi?.id, pdfVersion]);

  useEffect(() => setPageInput(String(pageNum)), [pageNum]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !viewerRef.current) return;
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const avail = viewerRef.current.clientWidth - 48;
    setScale(clamp(avail / base.width, MIN_SCALE, MAX_SCALE));
  }, [pdf, pageNum]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      if (fitPendingRef.current) {
        fitPendingRef.current = false;
        const base = page.getViewport({ scale: 1 });
        const avail = (viewerRef.current?.clientWidth || 900) - 48;
        const fitted = clamp(avail / base.width, MIN_SCALE, MAX_SCALE);
        if (Math.abs(fitted - scale) > 0.001) return setScale(fitted); // re-runs this effect at the fitted scale
      }
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setPageSize({ width: viewport.width, height: viewport.height });

      renderTaskRef.current?.cancel();
      const task = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (e) {
        if (e?.name !== "RenderingCancelledException") console.error(e);
        return;
      }
      if (cancelled) return;

      // Selectable text layer, used by the "Select text" tool.
      const tl = textLayerRef.current;
      if (!tl) return;
      tl.innerHTML = "";
      tl.style.setProperty("--scale-factor", String(scale));
      const pdfjs = await loadPdfjs();
      const textContent = await page.getTextContent();
      if (cancelled) return;
      pdfjs.renderTextLayer({ textContentSource: textContent, container: tl, viewport, textDivs: [] });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNum, scale]);

  function goToPage(n) {
    if (!pdf) return;
    setPageNum(clamp(n, 1, pdf.numPages));
    setSelectedMarkId(null);
    setSelectedImageId(null);
    viewerRef.current?.scrollTo({ top: 0 });
  }

  const zoomBy = (factor) => setScale((s) => clamp(Math.round(s * factor * 100) / 100, MIN_SCALE, MAX_SCALE));

  // ---- marks: creation, labels, deletion -------------------------------------

  /** Pointer position relative to the rendered page, in CSS px. */
  function pagePoint(e) {
    const r = pageRef.current.getBoundingClientRect();
    return { x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height) };
  }

  function addMark(box) {
    if (!activeQuestionId) return;
    // The question's first mark gets the full "Qn: text" label (see fullLabelIds), later ones just "Qn".
    const info = questionIndex.get(activeQuestionId);
    const isFirst = !marks.some((m) => m.question_id === activeQuestionId);
    const labelChars = isFirst && info ? `Q${info.num}: ${info.q.text}`.length : 3;
    const mark = {
      id: newMarkId(),
      question_id: activeQuestionId,
      page: pageNum,
      ...box,
      ...defaultLabelPos(box, defaultStyle, labelChars),
      style: { ...defaultStyle },
    };
    updateMarks((ms) => [...ms, mark]);
    setSelectedMarkId(mark.id);
  }

  function onOverlayPointerDown(e) {
    if (e.button !== 0 || tool !== "box") return;
    setSelectedMarkId(null);
    const p = pagePoint(e);
    // Locked images sit under the overlay: a click selects one, but with a question picked
    // a drag still draws a box over it (the click is resolved on pointer-up instead).
    const armed = canEdit && activeQuestionId;
    setSelectedImageId(armed ? null : lockedImageAt(p)?.id ?? null);
    if (!armed) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function onOverlayPointerMove(e) {
    if (!drawing) return;
    const p = pagePoint(e);
    setDrawing((d) => d && { ...d, x1: p.x, y1: p.y });
  }

  function onOverlayPointerUp() {
    if (!drawing) return;
    const { x0, y0, x1, y1 } = drawing;
    setDrawing(null);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    if (w < MIN_BOX_PX || h < MIN_BOX_PX) {
      setSelectedImageId(lockedImageAt({ x: x1, y: y1 })?.id ?? null);
      return;
    }
    addMark({
      x: Math.min(x0, x1) / pageSize.width,
      y: Math.min(y0, y1) / pageSize.height,
      w: w / pageSize.width,
      h: h / pageSize.height,
    });
  }

  // "Select text" tool: when a selection in the text layer ends, cloud the
  // bounding box of everything selected.
  function onTextLayerMouseUp() {
    if (tool !== "text" || !canEdit) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    if (!activeQuestionId) {
      toast.error("Pick a question on the left first, then select its answer.");
      return;
    }
    const pr = pageRef.current.getBoundingClientRect();
    const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    sel.removeAllRanges();
    if (!rects.length) return;
    const pad = 4;
    const left = clamp(Math.min(...rects.map((r) => r.left)) - pr.left - pad, 0, pr.width);
    const top = clamp(Math.min(...rects.map((r) => r.top)) - pr.top - pad, 0, pr.height);
    const right = clamp(Math.max(...rects.map((r) => r.right)) - pr.left + pad, 0, pr.width);
    const bottom = clamp(Math.max(...rects.map((r) => r.bottom)) - pr.top + pad, 0, pr.height);
    if (right - left < MIN_BOX_PX || bottom - top < MIN_BOX_PX) return;
    addMark({ x: left / pr.width, y: top / pr.height, w: (right - left) / pr.width, h: (bottom - top) / pr.height });
  }

  function onLabelPointerDown(e, mark) {
    e.stopPropagation();
    setSelectedMarkId(mark.id);
    if (!canEdit || e.button !== 0) return;
    e.preventDefault();
    const p = pagePoint(e);
    labelDragRef.current = {
      id: mark.id,
      dx: mark.label_x * pageSize.width - p.x,
      dy: mark.label_y * pageSize.height - p.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onLabelPointerMove(e) {
    const drag = labelDragRef.current;
    if (!drag) return;
    const p = pagePoint(e);
    const lx = clamp((p.x + drag.dx) / pageSize.width, 0, 1);
    const ly = clamp((p.y + drag.dy) / pageSize.height, 0, 1);
    drag.moved = true;
    // Local-only while dragging; saved once on release.
    const next = marksRef.current.map((m) => (m.id === drag.id ? { ...m, label_x: lx, label_y: ly } : m));
    marksRef.current = next;
    setMarks(next);
  }

  function endLabelDrag() {
    const drag = labelDragRef.current;
    labelDragRef.current = null;
    if (drag?.moved) updateMarks((ms) => ms);
  }

  // Leader-line handles: "end" moves where the line meets the box (stored
  // relative to the box, kept inside it); "bend" adds/moves an elbow point.
  function onLineHandlePointerDown(e, mark, kind) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lineDragRef.current = { id: mark.id, kind, moved: false };
  }

  function onLineHandlePointerMove(e) {
    const drag = lineDragRef.current;
    if (!drag) return;
    const p = pagePoint(e);
    const fx = p.x / pageSize.width;
    const fy = p.y / pageSize.height;
    const next = marksRef.current.map((m) => {
      if (m.id !== drag.id) return m;
      if (drag.kind === "end") {
        return { ...m, line_end_x: clamp((fx - m.x) / m.w, 0, 1), line_end_y: clamp((fy - m.y) / m.h, 0, 1) };
      }
      return { ...m, line_bend_x: fx, line_bend_y: fy };
    });
    drag.moved = true;
    marksRef.current = next;
    setMarks(next);
  }

  function endLineHandleDrag() {
    const drag = lineDragRef.current;
    lineDragRef.current = null;
    if (drag?.moved) updateMarks((ms) => ms);
  }

  /** Clears a dragged line end and/or bend, back to the style's automatic line. */
  function resetLine(id, { end = false, bend = false } = {}) {
    if (!canEdit) return;
    updateMarks((ms) =>
      ms.map((m) =>
        m.id !== id
          ? m
          : {
              ...m,
              ...(end ? { line_end_x: null, line_end_y: null } : {}),
              ...(bend ? { line_bend_x: null, line_bend_y: null } : {}),
            }
      )
    );
  }

  const removeMark = useCallback(
    (id) => {
      updateMarks((ms) => ms.filter((m) => m.id !== id));
      setSelectedMarkId((cur) => (cur === id ? null : cur));
    },
    [updateMarks]
  );

  // ---- images: paste/drop, move, resize, lock --------------------------------

  // Selecting a mark (from anywhere — label, line, sidebar chip) drops the image selection.
  useEffect(() => {
    if (selectedMarkId) setSelectedImageId(null);
  }, [selectedMarkId]);

  /** The topmost locked image on this page under a page-px point. */
  function lockedImageAt(p) {
    const { width: pw, height: ph } = pageSize;
    for (let i = images.length - 1; i >= 0; i--) {
      const im = images[i];
      if (im.page !== pageNum || !im.locked) continue;
      if (p.x >= im.x * pw && p.x <= (im.x + im.w) * pw && p.y >= im.y * ph && p.y <= (im.y + im.h) * ph) return im;
    }
    return null;
  }

  /** Center of the part of the page currently scrolled into view, in page px. */
  function visiblePageCenter() {
    const vr = viewerRef.current?.getBoundingClientRect();
    const pr = pageRef.current?.getBoundingClientRect();
    if (!vr || !pr) return { x: pageSize.width / 2, y: pageSize.height / 2 };
    const left = Math.max(vr.left, pr.left);
    const right = Math.min(vr.right, pr.right);
    const top = Math.max(vr.top, pr.top);
    const bottom = Math.min(vr.bottom, pr.bottom);
    if (right <= left || bottom <= top) return { x: pr.width / 2, y: pr.height / 2 };
    return { x: (left + right) / 2 - pr.left, y: (top + bottom) / 2 - pr.top };
  }

  /** Uploads image files and places them on the current page, centered on `at` (page px) or the visible area. */
  async function placeImages(files, at) {
    const imgs = files.filter(isImageFile);
    if (!imgs.length || !canEdit) return;
    if (!pdf || !pageSize.width) {
      toast.error("Open a PDF first, then add images to it.");
      return;
    }
    const docId = activeDocId;
    const page = pageNum;
    const { width: pw, height: ph } = pageSize;
    const center = at || visiblePageCenter();
    setPlacingImage(true);
    try {
      const placed = [];
      for (const [i, f] of imgs.entries()) {
        const natural = await imageNaturalSize(f);
        const fd = new FormData();
        fd.append("image", f, f.name || "pasted.png");
        const res = await api.post(`/rfis/${rfi.id}/markups/${docId}/images`, fd);
        // Actual size at the current zoom, shrunk to fit within 40% of the page.
        const fit = Math.min(scale, (pw * 0.4) / natural.w, (ph * 0.4) / natural.h);
        const w = Math.max(MIN_IMAGE_PX, natural.w * fit);
        const h = Math.max(MIN_IMAGE_PX, natural.h * fit);
        const x = clamp(center.x + i * 20 - w / 2, 0, Math.max(0, pw - w));
        const y = clamp(center.y + i * 20 - h / 2, 0, Math.max(0, ph - h));
        placed.push({ id: newMarkId(), filename: res.filename, page, x: x / pw, y: y / ph, w: w / pw, h: h / ph, locked: false });
      }
      if (activeDocIdRef.current !== docId) return; // switched PDFs mid-upload
      updateImages((ims) => [...ims, ...placed]);
      setSelectedMarkId(null);
      setSelectedImageId(placed[placed.length - 1].id);
    } catch (e) {
      toast.error(`Couldn't add image: ${e.message}`);
    } finally {
      setPlacingImage(false);
      if (imageFileInputRef.current) imageFileInputRef.current.value = "";
    }
  }
  placeImagesRef.current = placeImages;

  // Ctrl+V an image (screenshot, copied picture) onto the current page.
  useEffect(() => {
    if (!open || !canEdit) return;
    function onPaste(e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      const files = [...(e.clipboardData?.items || [])]
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      placeImagesRef.current?.(files, null);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, canEdit]);

  function onViewerDragOver(e) {
    if (!canEdit || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    setViewerDragOver(true);
  }

  // Dropping images on the viewer places them where they land; dropped PDFs upload as usual.
  function onViewerDrop(e) {
    if (!canEdit) return;
    e.preventDefault();
    setViewerDragOver(false);
    const files = [...(e.dataTransfer?.files || [])];
    const imgs = files.filter(isImageFile);
    if (imgs.length && pdf) placeImages(imgs, pageRef.current ? pagePoint(e) : null);
    const rest = files.filter((f) => !imgs.includes(f));
    if (rest.length || (imgs.length && !pdf)) uploadFiles(rest.length ? rest : imgs);
  }

  function onImagePointerDown(e, im, handle = "move") {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedMarkId(null);
    setSelectedImageId(im.id);
    if (!canEdit || im.locked) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { width: pw, height: ph } = pageSize;
    imageDragRef.current = {
      id: im.id,
      handle,
      start: pagePoint(e),
      orig: { x: im.x * pw, y: im.y * ph, w: im.w * pw, h: im.h * ph },
      moved: false,
    };
  }

  // Body drag moves; corner handles scale keeping the aspect ratio (Shift: free); edge handles stretch.
  function onImagePointerMove(e) {
    const drag = imageDragRef.current;
    if (!drag) return;
    const { width: pw, height: ph } = pageSize;
    const p = pagePoint(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const o = drag.orig;
    let { x, y, w, h } = o;
    if (drag.handle === "move") {
      x = clamp(o.x + dx, 0, Math.max(0, pw - o.w));
      y = clamp(o.y + dy, 0, Math.max(0, ph - o.h));
    } else {
      const hz = drag.handle.includes("e") ? 1 : drag.handle.includes("w") ? -1 : 0;
      const vt = drag.handle.includes("s") ? 1 : drag.handle.includes("n") ? -1 : 0;
      if (hz && vt && !e.shiftKey) {
        const s = Math.max(MIN_IMAGE_PX / Math.min(o.w, o.h), 1 + ((hz * dx) / o.w + (vt * dy) / o.h) / 2);
        w = o.w * s;
        h = o.h * s;
      } else {
        if (hz) w = Math.max(MIN_IMAGE_PX, o.w + hz * dx);
        if (vt) h = Math.max(MIN_IMAGE_PX, o.h + vt * dy);
      }
      w = Math.min(w, pw);
      h = Math.min(h, ph);
      if (hz < 0) x = o.x + o.w - w;
      if (vt < 0) y = o.y + o.h - h;
    }
    drag.moved = true;
    // Local-only while dragging; saved once on release.
    const next = imagesRef.current.map((im) =>
      im.id === drag.id ? { ...im, x: clamp(x / pw, 0, 1), y: clamp(y / ph, 0, 1), w: w / pw, h: h / ph } : im
    );
    imagesRef.current = next;
    setImages(next);
  }

  function endImageDrag() {
    const drag = imageDragRef.current;
    imageDragRef.current = null;
    if (drag?.moved) updateImages((ims) => ims);
  }

  function toggleImageLock(id) {
    updateImages((ims) => ims.map((im) => (im.id === id ? { ...im, locked: !im.locked } : im)));
  }

  function removeImage(id) {
    updateImages((ims) => ims.filter((im) => im.id !== id));
    setSelectedImageId((cur) => (cur === id ? null : cur));
  }

  // ---- styling ---------------------------------------------------------------

  const selectedMark = marks.find((m) => m.id === selectedMarkId) || null;

  /** Style panel edits: the selected mark's style, or the default for new marks when none is selected. */
  function changeStyle(patch) {
    if (selectedMark) {
      // Picking a "Meets box at" option replaces any dragged line end.
      const clearEnd = patch.boxAnchor ? { line_end_x: null, line_end_y: null } : {};
      updateMarks((ms) =>
        ms.map((m) => (m.id === selectedMark.id ? { ...m, ...clearEnd, style: { ...markStyle(m), ...patch } } : m))
      );
    } else {
      setDefaultStyle((s) => {
        const next = { ...s, ...patch };
        storeDefaultStyle(next);
        return next;
      });
    }
  }

  function resetStyle() {
    if (selectedMark) updateMarks((ms) => ms.map((m) => (m.id === selectedMark.id ? { ...m, style: { ...DEFAULT_MARK_STYLE } } : m)));
    else {
      setDefaultStyle({ ...DEFAULT_MARK_STYLE });
      storeDefaultStyle(DEFAULT_MARK_STYLE);
    }
  }

  function applyStyleTo(predicate) {
    const style = selectedMark ? markStyle(selectedMark) : defaultStyle;
    updateMarks((ms) => ms.map((m) => (predicate(m) ? { ...m, style: { ...style } } : m)));
  }

  function jumpToMark(mark) {
    setActiveQuestionId(mark.question_id);
    if (mark.page !== pageNum) goToPage(mark.page);
    setSelectedMarkId(mark.id);
    setScrollTargetId(mark.id);
  }

  // Picking a question highlights its marks; if none are on this page, jump to the first one.
  function toggleQuestion(qId) {
    if (qId === activeQuestionId) {
      setActiveQuestionId(null);
      return;
    }
    setActiveQuestionId(qId);
    const qMarks = marksByQuestion.get(qId) || [];
    const target = qMarks.find((m) => m.page === pageNum) || qMarks[0];
    if (!target) return;
    if (target.page !== pageNum) goToPage(target.page);
    setScrollTargetId(target.id);
  }

  // Scroll the viewer so a jumped-to mark is in view once its page has laid out.
  useEffect(() => {
    const { width: pw, height: ph } = pageSize;
    if (!scrollTargetId || !pw || !ph) return;
    const m = marks.find((x) => x.id === scrollTargetId);
    if (!m || m.page !== pageNum) return;
    const viewer = viewerRef.current;
    const page = pageRef.current;
    if (viewer && page) {
      const vr = viewer.getBoundingClientRect();
      const pr = page.getBoundingClientRect();
      const top = Math.min(m.y, m.label_y ?? m.y) * ph;
      const left = Math.min(m.x, m.label_x ?? m.x) * pw;
      viewer.scrollTo({
        top: Math.max(0, viewer.scrollTop + pr.top - vr.top + top - 60),
        left: Math.max(0, viewer.scrollLeft + pr.left - vr.left + left - 40),
        behavior: "smooth",
      });
    }
    setScrollTargetId(null);
  }, [scrollTargetId, pageNum, pageSize, marks]);

  // Esc deselects the selected mark/image, otherwise closes the workspace (even from a focused
  // field); Delete removes the selected mark, or the selected image unless it's locked.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (selectedMarkId || selectedImageId) {
          setSelectedMarkId(null);
          setSelectedImageId(null);
        } else {
          if (typing) document.activeElement.blur(); // commits e.g. the page-number field before closing
          handleClose();
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && canEdit && !typing) {
        if (selectedMarkId) {
          e.preventDefault();
          removeMark(selectedMarkId);
        } else if (selectedImageId && !imagesRef.current.find((im) => im.id === selectedImageId)?.locked) {
          e.preventDefault();
          removeImage(selectedImageId);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedMarkId, selectedImageId, canEdit, removeMark]);

  async function handleClose() {
    await flushSave();
    onClose();
  }

  // Which mark of each question gets the full "Qn: text" label — its first in reading order.
  const fullLabelIds = useMemo(() => fullLabelMarkIds(marks), [marks]);

  const marksByQuestion = useMemo(() => {
    const g = new Map();
    for (const m of [...marks].sort((a, b) => a.page - b.page || a.y - b.y)) {
      if (!g.has(m.question_id)) g.set(m.question_id, []);
      g.get(m.question_id).push(m);
    }
    return g;
  }, [marks]);
  const orphanMarks = marks.filter((m) => !questionIndex.has(m.question_id));
  const pageMarks = marks.filter((m) => m.page === pageNum);
  const pageImages = images.filter((im) => im.page === pageNum);
  const selectedImage = pageImages.find((im) => im.id === selectedImageId) || null;

  if (!open || !rfi) return null;

  // ---- render ----------------------------------------------------------------

  const { width: pw, height: ph } = pageSize;
  const unit = pw / 1000; // style sizes are px at a 1000px-wide page (see RfiMarkStylePanel)
  const activeQ = activeQuestionId ? questionIndex.get(activeQuestionId) : null;
  const selectedQ = selectedMark ? questionIndex.get(selectedMark.question_id) : null;

  const hint = !canEdit
    ? "View only — you don't have permission to edit markups."
    : selectedImage && !selectedImage.locked
    ? "Drag the image to move it, or its handles to resize (hold Shift on a corner to stretch). Lock it to keep it in place and draw marks over it."
    : !activeQ
    ? "Pick a question on the left, then mark its answer on the drawing. Paste (Ctrl+V) or drop an image to place it on the page."
    : tool === "box"
    ? `Drag a box around the answer to Q${activeQ.num}.`
    : `Highlight the answer text to Q${activeQ.num}.`;

  const workspace = (
    <div className="rfi-mk-backdrop" role="dialog" aria-modal="true" aria-label={`Mark up: ${rfi.title}`}>
      <div className="rfi-mk-shell">
        {/* Header */}
        <div className="rfi-mk-header">
          <div className="co-modal-header-icon co-modal-header-icon-amber">
            <i className="bi bi-pencil-square" />
          </div>
          <div className="rfi-mk-header-title">
            <div className="co-modal-title">Mark Up — {rfi.title}</div>
            <div className="co-modal-subtitle">
              <span className="rfi-type-pill">{rfi.type}</span> Link each question to its answer on the drawings
            </div>
          </div>
          <span className={`rfi-mk-save rfi-mk-save-${saveState}`} aria-live="polite">
            {saveState === "saving" && (
              <>
                <span className="spinner-border spinner-border-sm" /> Saving…
              </>
            )}
            {saveState === "saved" && (
              <>
                <i className="bi bi-check2-circle" /> Saved
              </>
            )}
            {saveState === "error" && (
              <button type="button" className="btn btn-link btn-sm p-0 text-danger" onClick={() => updateMarks((ms) => ms)}>
                <i className="bi bi-exclamation-triangle" /> Not saved — retry
              </button>
            )}
          </span>
          {activeDoc && (
            <div className="rfi-mk-header-actions">
              {canEdit && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => imageFileInputRef.current?.click()}
                    disabled={!pdf || placingImage}
                    title="Add an image to this page — you can also paste (Ctrl+V) or drag one onto the page"
                  >
                    {placingImage ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-image" />} Image
                  </button>
                  <input
                    ref={imageFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    multiple
                    hidden
                    onChange={(e) => placeImages([...(e.target.files || [])], null)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => appendInputRef.current?.click()}
                    disabled={!pdf || appending}
                    title="Add the pages of another PDF to the end of this one"
                  >
                    {appending ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-file-earmark-plus" />} Add page
                  </button>
                  <input
                    ref={appendInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    hidden
                    onChange={(e) => appendPages(e.target.files)}
                  />
                </>
              )}
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={downloadActive}
                disabled={!pdf || downloading}
                title="Download this PDF with its marks drawn in"
              >
                {downloading ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-download" />} Download
              </button>
            </div>
          )}
          <button type="button" className="rfi-mk-close" onClick={handleClose} aria-label="Close" title="Close (Esc)">
            <i className="bi bi-x-lg" /> Close
          </button>
        </div>

        {/* Upload + document tabs */}
        <div className="rfi-mk-topbar">
          {canEdit && (
            <div
              className={`rfi-mk-dropzone${dragOver ? " rfi-mk-dropzone-over" : ""}${uploading ? " rfi-mk-dropzone-busy" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                uploadFiles(e.dataTransfer.files);
              }}
              onClick={() => !uploading && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
            >
              {uploading ? (
                <>
                  <span className="spinner-border spinner-border-sm" /> Uploading…
                </>
              ) : (
                <>
                  <i className="bi bi-cloud-arrow-up" /> Drag and drop PDF files here, or <span className="rfi-mk-browse">browse to upload</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                onChange={(e) => uploadFiles(e.target.files)}
              />
            </div>
          )}
          <div className="rfi-mk-doc-tabs">
            {docsLoading && <span className="text-muted small">Loading…</span>}
            {docs.map((d) => (
              <div key={d.id} className={`rfi-mk-doc-tab${d.id === activeDocId ? " active" : ""}`}>
                <button type="button" className="rfi-mk-doc-tab-name" onClick={() => switchDoc(d.id)} title={d.original_name}>
                  <i className="bi bi-file-earmark-pdf" /> {d.original_name}
                </button>
                {canEdit && (
                  <button type="button" className="rfi-mk-doc-tab-del" onClick={() => deleteDoc(d)} aria-label={`Remove ${d.original_name}`}>
                    <i className="bi bi-x" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rfi-mk-body">
          {/* Question list */}
          <aside className="rfi-mk-sidebar">
            <div className="rfi-questions-label">
              <i className="bi bi-list-check" /> Questions ({questions.length})
            </div>
            {questions.length === 0 && <div className="text-muted small">This RFI has no questions.</div>}
            {questions.map((q, idx) => {
              const qMarks = marksByQuestion.get(q.id) || [];
              const active = q.id === activeQuestionId;
              return (
                <div key={q.id} className={`rfi-mk-q${active ? " active" : ""}`}>
                  <button
                    type="button"
                    className="rfi-mk-q-main"
                    onClick={() => toggleQuestion(q.id)}
                    aria-pressed={active}
                  >
                    <span className={`rfi-question-badge${q.response_received_date ? " rfi-question-badge-received" : ""}`}>
                      <span>Q{idx + 1}</span>
                    </span>
                    <span className="rfi-mk-q-text">
                      {q.text}
                      {q.answer && (
                        <span className="rfi-mk-q-answer">
                          <i className="bi bi-reply-fill" /> {q.answer}
                        </span>
                      )}
                    </span>
                    <span className={`rfi-mk-q-count${qMarks.length ? " has" : ""}`} title={`${qMarks.length} mark(s)`}>
                      <i className="bi bi-cloud" /> {qMarks.length}
                    </span>
                  </button>
                  {qMarks.length > 0 && (
                    <div className="rfi-mk-q-marks">
                      {qMarks.map((m, i) => (
                        <span key={m.id} className={`rfi-mk-mark-chip${m.id === selectedMarkId ? " selected" : ""}`}>
                          <button type="button" onClick={() => jumpToMark(m)} title="Go to this mark">
                            p.{m.page}
                            {i === 0 ? " · full label" : ""}
                          </button>
                          {canEdit && (
                            <button type="button" className="rfi-mk-mark-chip-del" onClick={() => removeMark(m.id)} aria-label="Remove mark">
                              <i className="bi bi-x" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {orphanMarks.length > 0 && (
              <div className="rfi-mk-orphans">
                <div className="small text-muted mb-1">
                  <i className="bi bi-exclamation-circle" /> {orphanMarks.length} mark(s) for removed questions
                </div>
                <div className="rfi-mk-q-marks">
                  {orphanMarks.map((m) => (
                    <span key={m.id} className="rfi-mk-mark-chip">
                      <button type="button" onClick={() => jumpToMark(m)}>p.{m.page}</button>
                      {canEdit && (
                        <button type="button" className="rfi-mk-mark-chip-del" onClick={() => removeMark(m.id)} aria-label="Remove mark">
                          <i className="bi bi-x" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Viewer */}
          <section className="rfi-mk-main">
            {activeDoc && (
              <div className="rfi-mk-toolbar">
                <div className="btn-group btn-group-sm">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => goToPage(pageNum - 1)} disabled={!pdf || pageNum <= 1} aria-label="Previous page">
                    <i className="bi bi-chevron-left" />
                  </button>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => goToPage(pageNum + 1)} disabled={!pdf || pageNum >= (pdf?.numPages || 1)} aria-label="Next page">
                    <i className="bi bi-chevron-right" />
                  </button>
                </div>
                <span className="rfi-mk-pageinfo">
                  Page
                  <input
                    className="form-control form-control-sm"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                    onBlur={() => goToPage(Number(pageInput) || pageNum)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    aria-label="Page number"
                    disabled={!pdf}
                  />
                  of {pdf?.numPages || "—"}
                </span>
                <div className="btn-group btn-group-sm">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => zoomBy(1 / 1.2)} disabled={!pdf} aria-label="Zoom out">
                    <i className="bi bi-zoom-out" />
                  </button>
                  <span className="btn btn-outline-secondary disabled rfi-mk-zoom">{Math.round(scale * 100)}%</span>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => zoomBy(1.2)} disabled={!pdf} aria-label="Zoom in">
                    <i className="bi bi-zoom-in" />
                  </button>
                  <button type="button" className="btn btn-outline-secondary" onClick={fitWidth} disabled={!pdf} title="Fit to width">
                    <i className="bi bi-arrows-expand-vertical" /> Fit
                  </button>
                </div>
                {canEdit && !styleOpen && (
                  <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={() => setStyleOpen(true)}>
                    <i className="bi bi-palette" /> Style
                  </button>
                )}
                {canEdit && (
                  <div className={`btn-group btn-group-sm${styleOpen ? " ms-auto" : ""}`} role="group" aria-label="Markup tool">
                    <button type="button" className={`btn ${tool === "box" ? "btn-danger" : "btn-outline-danger"}`} onClick={() => setTool("box")}>
                      <i className="bi bi-bounding-box" /> Draw box
                    </button>
                    <button type="button" className={`btn ${tool === "text" ? "btn-danger" : "btn-outline-danger"}`} onClick={() => setTool("text")}>
                      <i className="bi bi-cursor-text" /> Select text
                    </button>
                  </div>
                )}
              </div>
            )}
            {activeDoc && <div className={`rfi-mk-hint${activeQ && canEdit ? " armed" : ""}`}>{hint}</div>}

            <div
              className={`rfi-mk-viewer${viewerDragOver ? " rfi-mk-viewer-dragover" : ""}`}
              ref={viewerRef}
              onDragOver={onViewerDragOver}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setViewerDragOver(false)}
              onDrop={onViewerDrop}
            >
              {!activeDoc && !docsLoading && (
                <div className="rfi-mk-empty">
                  <i className="bi bi-file-earmark-pdf" />
                  <div>{canEdit ? "Upload a PDF above to start marking up this RFI." : "No PDFs have been marked up for this RFI yet."}</div>
                </div>
              )}
              {activeDoc && pdfLoading && (
                <div className="rfi-mk-empty">
                  <span className="spinner-border" />
                </div>
              )}
              {activeDoc && pdfError && (
                <div className="rfi-mk-empty text-danger">
                  <i className="bi bi-exclamation-triangle" />
                  <div>{pdfError}</div>
                </div>
              )}
              {activeDoc && pdf && (
                <div
                  className={`rfi-mk-page rfi-mk-tool-${canEdit ? tool : "view"}${activeQ && canEdit ? " armed" : ""}`}
                  ref={pageRef}
                  style={{ width: pw || undefined, height: ph || undefined }}
                >
                  <canvas ref={canvasRef} />
                  {/* Placed images. Locked ones sit under the text layer and marks overlay (so
                      marks draw over them and clicks pass through); unlocked ones float above to be dragged. */}
                  {pageImages.map((im) => {
                    const selected = im.id === selectedImageId;
                    const movable = canEdit && !im.locked;
                    return (
                      <div
                        key={im.id}
                        className={`rfi-mk-img${im.locked ? " locked" : ""}${selected ? " selected" : ""}${movable ? " movable" : ""}`}
                        style={{ left: im.x * pw, top: im.y * ph, width: im.w * pw, height: im.h * ph }}
                        onPointerDown={(e) => onImagePointerDown(e, im)}
                        onPointerMove={onImagePointerMove}
                        onPointerUp={endImageDrag}
                        onPointerCancel={endImageDrag}
                      >
                        <img
                          src={`${API_URL}/rfis/${rfi.id}/markups/${activeDocId}/images/${encodeURIComponent(im.filename)}`}
                          alt=""
                          draggable={false}
                        />
                        {selected &&
                          movable &&
                          IMAGE_HANDLES.map((hd) => (
                            <span
                              key={hd}
                              className={`rfi-mk-img-handle rfi-mk-img-handle-${hd}`}
                              onPointerDown={(e) => onImagePointerDown(e, im, hd)}
                            />
                          ))}
                      </div>
                    );
                  })}
                  <div className="textLayer rfi-mk-textlayer" ref={textLayerRef} onMouseUp={onTextLayerMouseUp} />
                  <svg
                    className="rfi-mk-overlay"
                    width={pw}
                    height={ph}
                    onPointerDown={onOverlayPointerDown}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerUp}
                    onPointerCancel={() => setDrawing(null)}
                  >
                    {pageMarks.map((m) => {
                      const x = m.x * pw;
                      const y = m.y * ph;
                      const w = m.w * pw;
                      const h = m.h * ph;
                      const lx = m.label_x * pw;
                      const ly = m.label_y * ph;
                      const s = markStyle(m);
                      const borderW = s.borderWidth * unit;
                      const lineW = s.lineWidth * unit;
                      // Leader line: label anchor → optional dragged bend point → the box,
                      // either at a dragged spot (line_end_*, relative to the box) or where the style picks.
                      const bend = m.line_bend_x != null ? [m.line_bend_x * pw, m.line_bend_y * ph] : null;
                      const from = bend || [lx, ly];
                      const end =
                        s.lineStyle === "none"
                          ? null
                          : m.line_end_x != null
                          ? [x + m.line_end_x * w, y + m.line_end_y * h]
                          : boxAnchorPoint(s.boxAnchor, x, y, w, h, from[0], from[1]);
                      const linePoints = end && `${lx},${ly} ${bend ? `${bend[0]},${bend[1]} ` : ""}${end[0]},${end[1]}`;
                      const selected = m.id === selectedMarkId;
                      const selectMark = (e) => {
                        if (tool !== "box" && canEdit) return;
                        e.stopPropagation();
                        setSelectedMarkId(m.id);
                      };
                      const showHandles = selected && canEdit && end;
                      const midHandle = bend || [(lx + end?.[0]) / 2, (ly + end?.[1]) / 2];
                      let arrow = null;
                      if (end && s.lineEnd === "arrow") {
                        const a = Math.atan2(end[1] - from[1], end[0] - from[0]);
                        const len = Math.max(6, lineW * 5);
                        const pt = (da) => `${end[0] - len * Math.cos(a + da)},${end[1] - len * Math.sin(a + da)}`;
                        arrow = `${end[0]},${end[1]} ${pt(0.45)} ${pt(-0.45)}`;
                      }
                      const focus = activeQuestionId ? (m.question_id === activeQuestionId ? " focus" : " dimmed") : "";
                      return (
                        <g key={m.id} className={`rfi-mk-mark${selected ? " selected" : ""}${focus}`}>
                          {focus === " focus" && (
                            <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={6} className="rfi-mk-focus-halo" />
                          )}
                          {s.borderStyle === "cloud" ? (
                            <path
                              d={cloudPath(x, y, w, h, Math.min(s.cloudSize * unit, Math.max(2, Math.min(w, h) / 3)))}
                              fill={s.fillColor}
                              fillOpacity={s.fillOpacity}
                              stroke={s.borderColor}
                              strokeWidth={borderW}
                              strokeLinejoin="round"
                              onPointerDown={selectMark}
                            />
                          ) : (
                            <rect
                              x={x}
                              y={y}
                              width={w}
                              height={h}
                              fill={s.fillColor}
                              fillOpacity={s.fillOpacity}
                              stroke={s.borderColor}
                              strokeWidth={borderW}
                              strokeDasharray={s.borderStyle === "dashed" ? `${borderW * 4} ${borderW * 2.5}` : undefined}
                              onPointerDown={selectMark}
                            />
                          )}
                          {end && (
                            <>
                              <polyline
                                points={linePoints}
                                fill="none"
                                stroke={s.lineColor}
                                strokeWidth={lineW}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeDasharray={
                                  s.lineStyle === "dashed" ? `${lineW * 5} ${lineW * 3}` : s.lineStyle === "dotted" ? `0 ${lineW * 2.5}` : undefined
                                }
                              />
                              {s.lineEnd === "dot" && <circle cx={end[0]} cy={end[1]} r={Math.max(2, lineW * 1.8)} fill={s.lineColor} />}
                              {arrow && <polygon points={arrow} fill={s.lineColor} />}
                              {/* Wide invisible hit area: click the line to select the mark, drag it to bend it */}
                              <polyline
                                points={linePoints}
                                className="rfi-mk-line-hit"
                                strokeWidth={Math.max(12, lineW * 4)}
                                onPointerDown={(e) => {
                                  selectMark(e);
                                  if (canEdit) onLineHandlePointerDown(e, m, "bend");
                                }}
                                onPointerMove={onLineHandlePointerMove}
                                onPointerUp={endLineHandleDrag}
                                onPointerCancel={endLineHandleDrag}
                              />
                            </>
                          )}
                          {selected && (
                            <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} className="rfi-mk-selbox" />
                          )}
                          {showHandles && (
                            <>
                              <circle
                                cx={midHandle[0]}
                                cy={midHandle[1]}
                                r={6}
                                className={`rfi-mk-handle${bend ? "" : " rfi-mk-handle-ghost"}`}
                                onPointerDown={(e) => onLineHandlePointerDown(e, m, "bend")}
                                onPointerMove={onLineHandlePointerMove}
                                onPointerUp={endLineHandleDrag}
                                onPointerCancel={endLineHandleDrag}
                                onDoubleClick={() => resetLine(m.id, { bend: true })}
                              >
                                <title>{bend ? "Drag to move the bend — double-click to straighten" : "Drag to bend the line"}</title>
                              </circle>
                              <circle
                                cx={end[0]}
                                cy={end[1]}
                                r={7}
                                className="rfi-mk-handle"
                                onPointerDown={(e) => onLineHandlePointerDown(e, m, "end")}
                                onPointerMove={onLineHandlePointerMove}
                                onPointerUp={endLineHandleDrag}
                                onPointerCancel={endLineHandleDrag}
                                onDoubleClick={() => resetLine(m.id, { end: true })}
                              >
                                <title>Drag to move where the line meets the box — double-click to reset</title>
                              </circle>
                            </>
                          )}
                        </g>
                      );
                    })}
                    {drawing && (
                      <rect
                        x={Math.min(drawing.x0, drawing.x1)}
                        y={Math.min(drawing.y0, drawing.y1)}
                        width={Math.abs(drawing.x1 - drawing.x0)}
                        height={Math.abs(drawing.y1 - drawing.y0)}
                        className="rfi-mk-drawing"
                      />
                    )}
                  </svg>

                  {/* Callout labels (HTML so long question text wraps naturally) */}
                  {pageMarks.map((m) => {
                    const info = questionIndex.get(m.question_id);
                    const tag = info ? `Q${info.num}` : "Q?";
                    const full = fullLabelIds.has(m.id) && info;
                    const s = markStyle(m);
                    const side = s.labelSide !== "auto" ? s.labelSide : m.label_x < m.x + m.w / 2 ? "right" : "left";
                    return (
                      <div
                        key={m.id}
                        className={`rfi-mk-label${full ? " full" : ""}${m.id === selectedMarkId ? " selected" : ""}${canEdit ? " draggable" : ""}${
                          activeQuestionId ? (m.question_id === activeQuestionId ? " focus" : " dimmed") : ""
                        }`}
                        style={{
                          left: m.label_x * pw,
                          top: m.label_y * ph,
                          fontSize: Math.max(4, s.fontSize * unit),
                          color: s.textColor,
                          background: s.labelBg,
                          borderColor: s.lineStyle === "none" ? s.borderColor : s.lineColor,
                          borderWidth: Math.max(1, s.lineWidth * unit),
                          transform: LABEL_TRANSFORM[side] || LABEL_TRANSFORM.left,
                        }}
                        onPointerDown={(e) => onLabelPointerDown(e, m)}
                        onPointerMove={onLabelPointerMove}
                        onPointerUp={endLabelDrag}
                        onPointerCancel={endLabelDrag}
                        title={info ? `Q${info.num}: ${info.q.text}` : "Question was removed from this RFI"}
                      >
                        <strong>{tag}</strong>
                        {full && <span>: {info.q.text}</span>}
                      </div>
                    );
                  })}

                  {/* Delete button for the selected mark */}
                  {canEdit &&
                    pageMarks
                      .filter((m) => m.id === selectedMarkId)
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="rfi-mk-mark-del"
                          style={{ left: (m.x + m.w) * pw, top: m.y * ph }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => removeMark(m.id)}
                          aria-label="Remove this mark"
                          title="Remove mark (Del)"
                        >
                          <i className="bi bi-trash" />
                        </button>
                      ))}

                  {/* Lock / delete for the selected image */}
                  {canEdit && selectedImage && (
                    <div
                      className="rfi-mk-img-toolbar"
                      style={{ left: (selectedImage.x + selectedImage.w) * pw, top: selectedImage.y * ph }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className={selectedImage.locked ? "active" : ""}
                        onClick={() => toggleImageLock(selectedImage.id)}
                        title={selectedImage.locked ? "Unlock — allow moving and resizing" : "Lock in place"}
                        aria-pressed={selectedImage.locked}
                      >
                        <i className={`bi ${selectedImage.locked ? "bi-lock-fill" : "bi-unlock"}`} /> {selectedImage.locked ? "Locked" : "Lock"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => removeImage(selectedImage.id)}
                        title={selectedImage.locked ? "Remove image" : "Remove image (Del)"}
                        aria-label="Remove image"
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {canEdit && styleOpen && (
            <RfiMarkStylePanel
              style={selectedMark ? markStyle(selectedMark) : defaultStyle}
              target={
                selectedMark
                  ? `Editing selected mark — ${selectedQ ? `Q${selectedQ.num}` : "removed question"}, page ${selectedMark.page}`
                  : "Default for new marks — select a mark on the drawing to style just that one"
              }
              onChange={changeStyle}
              onReset={resetStyle}
              onApplyAll={() => applyStyleTo(() => true)}
              onApplyQuestion={
                selectedMark && selectedQ
                  ? { label: `Q${selectedQ.num}`, fn: () => applyStyleTo((m) => m.question_id === selectedMark.question_id) }
                  : null
              }
              onMakeDefault={
                selectedMark
                  ? () => {
                      const style = markStyle(selectedMark);
                      setDefaultStyle(style);
                      storeDefaultStyle(style);
                      toast.success("Saved as the default style for new marks.");
                    }
                  : null
              }
              onClose={() => setStyleOpen(false)}
              lineCustomEnd={selectedMark?.line_end_x != null}
              onResetLine={
                selectedMark && (selectedMark.line_end_x != null || selectedMark.line_bend_x != null)
                  ? () => resetLine(selectedMark.id, { end: true, bend: true })
                  : null
              }
            />
          )}
        </div>
      </div>
    </div>
  );

  // Portaled to <body> so no transformed/animated ancestor (e.g. .st-modal's
  // slide-up) can become the containing block for this position:fixed overlay.
  return createPortal(workspace, document.body);
}
