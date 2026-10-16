"use client";

// Sizes (borderWidth, cloudSize, fontSize, lineWidth) are in "page units":
// px at a 1000px-wide render, scaled with the page so a mark looks the same
// at every zoom level. Mirrored server-side in rfis.js's parseMarkStyle.
export const DEFAULT_MARK_STYLE = {
  borderStyle: "cloud", // cloud | rect | dashed
  borderColor: "#ff0000",
  borderWidth: 2,
  cloudSize: 7,
  fillColor: "#ffff00",
  fillOpacity: 0.3,
  fontSize: 12,
  textColor: "#b00000",
  labelBg: "#ffffff",
  lineColor: "#ff0000",
  lineWidth: 1.5,
  lineStyle: "solid", // solid | dashed | dotted | none
  lineEnd: "dot", // dot | arrow | none
  // Line runs center-of-label → center-of-box by default, stopping at the box border.
  labelSide: "center", // where the line leaves the label: center | auto (side facing box) | left | right | top | bottom
  boxAnchor: "edge-center", // where it meets the box: edge-center | nearest | top | right | bottom | left | center
};

export const resolveMarkStyle = (style) => ({ ...DEFAULT_MARK_STYLE, ...(style || {}) });

function Segmented({ value, options, onChange }) {
  return (
    <div className="btn-group btn-group-sm rfi-mk-style-seg" role="group">
      {options.map(([v, label, icon]) => (
        <button
          key={v}
          type="button"
          className={`btn ${value === v ? "btn-danger" : "btn-outline-secondary"}`}
          onClick={() => onChange(v)}
          title={label}
          aria-pressed={value === v}
        >
          {icon ? <i className={`bi ${icon}`} /> : label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <label className="rfi-mk-style-row">
      <span className="rfi-mk-style-label">{label}</span>
      <span className="rfi-mk-style-control">{children}</span>
    </label>
  );
}

function ColorInput({ value, onChange }) {
  return (
    <span className="rfi-mk-style-color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <code>{value.toUpperCase()}</code>
    </span>
  );
}

function Slider({ value, min, max, step, onChange, format = (v) => v }) {
  // +/- nudge by one step, clamped, and rounded so 0.05 steps don't drift (0.30000000000000004).
  const nudge = (dir) => {
    const next = Math.min(max, Math.max(min, value + dir * step));
    onChange(Number(next.toFixed(6)));
  };
  return (
    <span className="rfi-mk-style-slider">
      <button type="button" className="rfi-mk-style-step" onClick={() => nudge(-1)} disabled={value <= min} title="Decrease" aria-label="Decrease">
        <i className="bi bi-dash" />
      </button>
      <input type="range" className="form-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <button type="button" className="rfi-mk-style-step" onClick={() => nudge(1)} disabled={value >= max} title="Increase" aria-label="Increase">
        <i className="bi bi-plus" />
      </button>
      <span className="rfi-mk-style-val">{format(value)}</span>
    </span>
  );
}

/**
 * Style editor for RFI markups — either the selected mark's style or, with
 * nothing selected, the default applied to new marks. Every change goes
 * straight through onChange(patch), so the drawing updates live.
 */
export default function RfiMarkStylePanel({
  style,
  target,
  onChange,
  onReset,
  onApplyAll,
  onApplyQuestion,
  onMakeDefault,
  onClose,
  lineCustomEnd = false,
  onResetLine = null,
}) {
  const s = resolveMarkStyle(style);
  const set = (key) => (v) => onChange({ [key]: v });

  return (
    <aside className="rfi-mk-stylepanel" aria-label="Markup style">
      <div className="rfi-mk-style-head">
        <div>
          <div className="rfi-mk-style-title">
            <i className="bi bi-palette" /> Style
          </div>
          <div className="rfi-mk-style-target">{target}</div>
        </div>
        <button type="button" className="co-modal-close" onClick={onClose} aria-label="Hide style panel">
          <i className="bi bi-chevron-right" />
        </button>
      </div>

      <div className="rfi-mk-style-section">Box</div>
      <Row label="Shape">
        <Segmented
          value={s.borderStyle}
          onChange={set("borderStyle")}
          options={[
            ["cloud", "Cloud", "bi-cloud"],
            ["rect", "Rectangle", "bi-square"],
            ["dashed", "Dashed rectangle", "bi-bounding-box"],
          ]}
        />
      </Row>
      <Row label="Border color">
        <ColorInput value={s.borderColor} onChange={set("borderColor")} />
      </Row>
      <Row label="Thickness">
        <Slider value={s.borderWidth} min={0.5} max={10} step={0.5} onChange={set("borderWidth")} />
      </Row>
      {s.borderStyle === "cloud" && (
        <Row label="Cloud bumps">
          <Slider value={s.cloudSize} min={3} max={25} step={1} onChange={set("cloudSize")} />
        </Row>
      )}
      <Row label="Fill color">
        <ColorInput value={s.fillColor} onChange={set("fillColor")} />
      </Row>
      <Row label="Fill opacity">
        <Slider value={s.fillOpacity} min={0} max={1} step={0.05} onChange={set("fillOpacity")} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>

      <div className="rfi-mk-style-section">Question label</div>
      <Row label="Font size">
        <Slider value={s.fontSize} min={6} max={40} step={1} onChange={set("fontSize")} />
      </Row>
      <Row label="Text color">
        <ColorInput value={s.textColor} onChange={set("textColor")} />
      </Row>
      <Row label="Background">
        <ColorInput value={s.labelBg} onChange={set("labelBg")} />
      </Row>

      <div className="rfi-mk-style-section">Connecting line</div>
      <Row label="Line">
        <Segmented
          value={s.lineStyle}
          onChange={set("lineStyle")}
          options={[
            ["solid", "Solid"],
            ["dashed", "Dashed"],
            ["dotted", "Dotted"],
            ["none", "None"],
          ]}
        />
      </Row>
      {s.lineStyle !== "none" && (
        <>
          <Row label="Line color">
            <ColorInput value={s.lineColor} onChange={set("lineColor")} />
          </Row>
          <Row label="Thickness">
            <Slider value={s.lineWidth} min={0.5} max={8} step={0.5} onChange={set("lineWidth")} />
          </Row>
          <Row label="End at box">
            <Segmented
              value={s.lineEnd}
              onChange={set("lineEnd")}
              options={[
                ["dot", "Dot"],
                ["arrow", "Arrow"],
                ["none", "None"],
              ]}
            />
          </Row>
          <Row label="Starts from label">
            <select className="form-select form-select-sm" value={s.labelSide} onChange={(e) => set("labelSide")(e.target.value)}>
              <option value="center">Center of label</option>
              <option value="auto">Side facing box</option>
              <option value="left">Left edge</option>
              <option value="right">Right edge</option>
              <option value="top">Top edge</option>
              <option value="bottom">Bottom edge</option>
            </select>
          </Row>
          <Row label="Meets box at">
            <select
              className="form-select form-select-sm"
              value={lineCustomEnd ? "custom" : s.boxAnchor}
              onChange={(e) => set("boxAnchor")(e.target.value)}
            >
              {lineCustomEnd && (
                <option value="custom" disabled>
                  Custom (dragged)
                </option>
              )}
              <option value="edge-center">Toward box center (stops at border)</option>
              <option value="nearest">Nearest point</option>
              <option value="top">Top middle</option>
              <option value="right">Right middle</option>
              <option value="bottom">Bottom middle</option>
              <option value="left">Left middle</option>
              <option value="center">Center</option>
            </select>
          </Row>
        </>
      )}
      {onResetLine && (
        <button type="button" className="btn btn-sm btn-outline-secondary w-100 mb-2" onClick={onResetLine}>
          <i className="bi bi-slash-lg" /> Straighten &amp; reset line position
        </button>
      )}
      <div className="rfi-mk-style-note">
        Drag a label to move it. With a mark selected, drag the blue handles (or the line itself) to move where the line meets the
        box or to bend it; double-click a handle to reset it. The label border uses the line color.
      </div>

      <div className="rfi-mk-style-actions">
        {onMakeDefault && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onMakeDefault}>
            <i className="bi bi-bookmark-star" /> Use as default for new marks
          </button>
        )}
        {onApplyQuestion && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onApplyQuestion.fn}>
            <i className="bi bi-files" /> Apply to all {onApplyQuestion.label} marks
          </button>
        )}
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onApplyAll}>
          <i className="bi bi-collection" /> Apply to every mark in this PDF
        </button>
        <button type="button" className="btn btn-sm btn-link text-danger" onClick={onReset}>
          <i className="bi bi-arrow-counterclockwise" /> Reset to standard style
        </button>
      </div>
    </aside>
  );
}
