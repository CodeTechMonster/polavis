import PDFDocument from "pdfkit";

// Print-friendly light theme (dark app UI colors would waste ink / look odd on paper).
export const COLORS = {
  text: "#14161A",
  textSecondary: "#5B6270",
  textMuted: "#9098A6",
  border: "#DCE0E6",
  surface: "#F5F6F8",
  accent: "#B9770E",
  accent2: "#2563AA",
  success: "#1E8E5A",
  danger: "#C23B3B",
  warning: "#B9770E",
};

export const PAGE_MARGIN = 50;

export function newDoc(): PDFKit.PDFDocument {
  return new PDFDocument({ size: "LETTER", margin: PAGE_MARGIN, bufferPages: true });
}

// IMPORTANT pdfkit lesson (found via visual QA, not assumed): calling .text(str, x, y) with an
// EXPLICIT position moves the internal cursor (doc.x) to wherever that text ended, not back to
// the left margin -- unlike flowing .text(str) calls (no x/y given), which auto-return to the
// margin on each new line. Every helper below re-anchors to PAGE_MARGIN explicitly and sets
// doc.x/doc.y by hand after positioned calls, rather than trusting doc.x to still be at the
// margin. (The first version of this file didn't do this and every kv row after the first drifted
// further right across the page instead of stacking vertically.)

export function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.x = PAGE_MARGIN;
  doc.fillColor(COLORS.text).fontSize(20).font("Helvetica-Bold").text(title, PAGE_MARGIN, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.2);
  doc.fillColor(COLORS.textSecondary).fontSize(10).font("Helvetica").text(subtitle, PAGE_MARGIN, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.6);
  const y = doc.y;
  doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).strokeColor(COLORS.border).lineWidth(1).stroke();
  doc.y = y + 16;
  doc.x = PAGE_MARGIN;
}

export function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);
  doc.fillColor(COLORS.text).fontSize(13).font("Helvetica-Bold").text(text, PAGE_MARGIN, doc.y);
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.3);
}

export function kvRow(doc: PDFKit.PDFDocument, label: string, value: string, opts: { valueColor?: string } = {}) {
  const y = doc.y;
  doc.fillColor(COLORS.textSecondary).fontSize(10).font("Helvetica").text(label, PAGE_MARGIN, y, { width: 180, lineBreak: false });
  doc.fillColor(opts.valueColor ?? COLORS.text).fontSize(10).font("Helvetica-Bold").text(value, PAGE_MARGIN + 190, y, { width: 250, lineBreak: false });
  doc.x = PAGE_MARGIN;
  doc.y = y + 18;
}

export function bulletList(doc: PDFKit.PDFDocument, items: string[], color: string = COLORS.text) {
  const width = doc.page.width - PAGE_MARGIN * 2 - 10;
  for (const item of items) {
    const y = doc.y;
    doc.font("Helvetica").fontSize(10).fillColor(color).text(`\u2022  ${item}`, PAGE_MARGIN + 10, y, { width });
    doc.x = PAGE_MARGIN;
    doc.moveDown(0.15);
  }
}

export function riskColor(score: number, levels: { low: number; medium: number; high: number }): string {
  if (score <= levels.low) return COLORS.success;
  if (score <= levels.medium) return COLORS.warning;
  if (score <= levels.high) return "#C2680E";
  return COLORS.danger;
}

/**
 * 4-axis radar ("방사형") chart of the sub-risk scores, mirroring the RiskRadarChart shown in the
 * app so the PDF and the dashboard read the same way: HOS top, Delay right, Detention bottom,
 * Empty Mile left, with the combined score in the middle.
 *
 * Drawn as vectors (lines/polygons) rather than an embedded raster image — pdfkit can do this
 * natively, so there's no headless-browser or chart-image dependency to add, and it stays sharp at
 * any zoom/print resolution.
 *
 * Cursor handling follows the same rule documented at the top of this file: every .text() call
 * here passes an explicit x/y, so doc.x/doc.y are re-anchored by hand at the end rather than
 * trusted. The caller continues below the chart as if it were a normal block.
 */
/**
 * Multi-series version of radarChart: draws one or more sub-risk profiles on the same 4 axes.
 *
 * Used for the What-if before/after comparison and the fleet-average profile. Kept as a separate
 * function rather than folding radarChart into it because radarChart also renders the big centred
 * total-score overlay, which only makes sense for a single leg.
 *
 * Same cursor discipline as the rest of this file: every .text() call is explicitly positioned, so
 * doc.x/doc.y are re-anchored by hand at the end.
 */
export function radarCompare(
  doc: PDFKit.PDFDocument,
  series: { label: string; values: [number, number, number, number]; color: string; dashed?: boolean }[],
  opts: { size?: number; caption?: string } = {}
) {
  const size = opts.size ?? 168;
  const radius = size / 2 - 24;
  const topY = doc.y;
  const cx = doc.page.width / 2;
  const cy = topY + size / 2;

  const axes = ["HOS", "Delay", "Detention", "Empty Mile"];
  const angleFor = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const pointAt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angleFor(i)) * r,
    cy + Math.sin(angleFor(i)) * r,
  ];

  doc.lineWidth(0.5).strokeColor(COLORS.border);
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    axes.forEach((_, i) => {
      const [x, y] = pointAt(i, radius * frac);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.closePath().stroke();
  }
  axes.forEach((_, i) => {
    const [x, y] = pointAt(i, radius);
    doc.moveTo(cx, cy).lineTo(x, y).stroke();
  });

  for (const sr of series) {
    const trace = () =>
      sr.values.forEach((v, i) => {
        const frac = Math.max(0, Math.min(100, v)) / 100;
        const [x, y] = pointAt(i, radius * frac);
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
    trace();
    doc.closePath().fillColor(sr.color).fillOpacity(0.22).fill();
    doc.fillOpacity(1);
    trace();
    doc.closePath().lineWidth(1.5).strokeColor(sr.color);
    if (sr.dashed) doc.dash(3, { space: 2 });
    doc.stroke();
    doc.undash();
  }

  // Axis labels carry the actual numbers, not just the axis name: without them the reader can see
  // the shape changed but has no idea by how much, which defeats the point of putting a radar in a
  // document they cannot hover over.
  doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.textSecondary);
  axes.forEach((a, i) => {
    const [lx, ly] = pointAt(i, radius + 11);
    const w = 74;
    const align: "center" | "left" | "right" = i === 1 ? "left" : i === 3 ? "right" : "center";
    const x = i === 1 ? lx + 2 : i === 3 ? lx - w - 2 : lx - w / 2;
    const y = i === 0 ? ly - 12 : i === 2 ? ly + 1 : ly - 7;
    const nums =
      series.length === 2
        ? `${Math.round(series[0].values[i])} -> ${Math.round(series[1].values[i])}`
        : series.map((sr) => Math.round(sr.values[i])).join(" / ");
    doc.text(a, x, y, { width: w, align, lineBreak: false });
    doc.fontSize(7).fillColor(COLORS.textMuted).text(nums, x, y + 8, { width: w, align, lineBreak: false });
    doc.fontSize(7.5).fillColor(COLORS.textSecondary);
  });

  // Legend under the chart, one entry per series.
  let ly2 = topY + size + 12;
  doc.font("Helvetica").fontSize(8);
  series.forEach((sr) => {
    doc.circle(cx - 78, ly2 + 3.5, 2.5).fillColor(sr.color).fill();
    doc.fillColor(COLORS.textSecondary).text(sr.label, cx - 70, ly2, { width: 160, lineBreak: false });
    ly2 += 11;
  });

  if (opts.caption) {
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COLORS.textMuted)
      .text(opts.caption, PAGE_MARGIN, ly2 + 1, { width: doc.page.width - PAGE_MARGIN * 2, align: "center" });
    ly2 += 12;
  }

  doc.x = PAGE_MARGIN;
  doc.y = ly2 + 4;
}

export function radarChart(
  doc: PDFKit.PDFDocument,
  risk: { hosRisk: number; delayRisk: number; detentionRisk: number; emptyMileRisk: number; riskScore: number },
  opts: { size?: number } = {}
) {
  const size = opts.size ?? 150;
  const radius = size / 2 - 22; // leave room for the axis labels outside the outer ring
  const topY = doc.y;
  // Centred on the page rather than left-anchored: the axis labels stick out ~80pt on each side,
  // so a left-anchored chart looks visibly off-balance against the full-width sections around it.
  const cx = doc.page.width / 2;
  const cy = topY + size / 2;

  // Axis order matches the app's radar exactly (clockwise from the top).
  const axes = [
    { label: "HOS", value: risk.hosRisk },
    { label: "Delay", value: risk.delayRisk },
    { label: "Detention", value: risk.detentionRisk },
    { label: "Empty Mile", value: risk.emptyMileRisk },
  ];

  // -90deg puts the first axis (HOS) straight up instead of pointing right.
  const angleFor = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const pointAt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angleFor(i)) * r,
    cy + Math.sin(angleFor(i)) * r,
  ];

  // Grid rings at 25/50/75/100 so a reader can eyeball roughly where each score sits.
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const r = radius * frac;
    axes.forEach((_, i) => {
      const [x, y] = pointAt(i, r);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.closePath().stroke();
  }

  // Spokes.
  axes.forEach((_, i) => {
    const [x, y] = pointAt(i, radius);
    doc.moveTo(cx, cy).lineTo(x, y).stroke();
  });

  // The score polygon itself. Values are 0-100 and clamped so a guardrail-forced 99/100 can't
  // overshoot the outer ring.
  axes.forEach((a, i) => {
    const frac = Math.max(0, Math.min(100, a.value)) / 100;
    const [x, y] = pointAt(i, radius * frac);
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  });
  doc.closePath().fillColor("#F87171").fillOpacity(0.35).fill();
  doc.fillOpacity(1);

  axes.forEach((a, i) => {
    const frac = Math.max(0, Math.min(100, a.value)) / 100;
    const [x, y] = pointAt(i, radius * frac);
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  });
  doc.closePath().lineWidth(1.5).strokeColor("#DC2626").stroke();

  // Axis labels with their values, positioned just outside the outer ring.
  doc.font("Helvetica").fontSize(8).fillColor(COLORS.textSecondary);
  axes.forEach((a, i) => {
    const [lx, ly] = pointAt(i, radius + 12);
    const label = `${a.label} ${Math.round(a.value)}`;
    const w = 70;
    // Nudge each label off the ring so it doesn't sit on top of the spoke it belongs to.
    const align: "center" | "left" | "right" = i === 1 ? "left" : i === 3 ? "right" : "center";
    const x = i === 1 ? lx + 2 : i === 3 ? lx - w - 2 : lx - w / 2;
    const y = i === 0 ? ly - 9 : i === 2 ? ly + 1 : ly - 4;
    doc.text(label, x, y, { width: w, align, lineBreak: false });
  });

  // Combined score in the middle, matching the app's center overlay. The score polygon is drawn
  // underneath and frequently passes straight through this area, so an opaque backing disc goes
  // down first — without it the centre number sits on top of the red fill and is hard to read
  // (confirmed by rendering the PDF and looking at it, not assumed).
  doc.circle(cx, cy, 21).fillColor("#FFFFFF").fill();
  doc.circle(cx, cy, 21).lineWidth(0.5).strokeColor(COLORS.border).stroke();

  doc.font("Helvetica").fontSize(5.5).fillColor(COLORS.textMuted)
    .text("TOTAL RISK", cx - 40, cy - 13, { width: 80, align: "center", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#DC2626")
    .text(String(Math.round(risk.riskScore)), cx - 40, cy - 6, { width: 80, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(5.5).fillColor(COLORS.textMuted)
    .text("/ 100", cx - 40, cy + 10, { width: 80, align: "center", lineBreak: false });

  // Re-anchor by hand (see the file-level note) and leave a little breathing room below.
  doc.x = PAGE_MARGIN;
  doc.y = topY + size + 6;
}

export function footer(doc: PDFKit.PDFDocument, note?: string) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // pdfkit auto-paginates based on the document's margins even for explicitly-positioned text,
    // so drawing inside the bottom margin zone (as any footer must) needs that margin temporarily
    // zeroed out — otherwise a footer line can silently push a new blank page onto the end of the
    // document (found via visual QA: a "Page 1 of 1" footer was rendering on a blank page 2).
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - 40;
    doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    doc.fillColor(COLORS.textMuted).fontSize(8).font("Helvetica")
      .text("Generated by RoadPilot AI Dispatch Advisor", PAGE_MARGIN, y + 8, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - PAGE_MARGIN - 100, y + 8, { width: 100, align: "right", lineBreak: false });
    if (note) {
      doc.fillColor(COLORS.textMuted).fontSize(7).text(note, PAGE_MARGIN, y + 20, {
        width: doc.page.width - PAGE_MARGIN * 2,
        lineBreak: false,
        ellipsis: true,
      });
    }

    doc.page.margins.bottom = originalBottom;
  }
}
