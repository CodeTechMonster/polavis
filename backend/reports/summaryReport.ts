import PDFDocument from "pdfkit";
import { header, sectionTitle, kvRow, radarCompare, footer, riskColor, COLORS } from "./pdfStyle.js";

export interface SummaryReportInput {
  generatedAt: Date;
  kpis: { activeLoads: number; totalDrivers: number; availableDrivers: number; highRiskLoads: number };
  levels: { low: number; medium: number; high: number };
  highRiskLoads: { TRIP_NUMBER: number; DRIVER_NAME: string; ORIG_ZONE_DESC: string; DEST_ZONE_DESC: string; riskScore: number; level: string }[];
  edgeCases: {
    counts: { alreadyInViolation: number; aboutToExhaust: number; chronicDetentionZones: number };
    chronicDetentionZones: { zone: string; highDetentionLegs: number }[];
  };
  detention: { totalDetentionFeesCAD: number; billableStops: number; topCustomers: { zone: string; feeCAD: number }[] };
  // Mean sub-risk across the whole fleet vs the high-risk subset. Optional so the report still
  // renders if a caller hasn't computed it.
  riskProfile?: {
    fleetAverage: { hosRisk: number; delayRisk: number; detentionRisk: number; emptyMileRisk: number };
    highRiskAverage: { hosRisk: number; delayRisk: number; detentionRisk: number; emptyMileRisk: number };
    fleetLegs: number;
    highRiskLegs: number;
  };
}

function levelLabel(score: number, levels: { low: number; medium: number; high: number }): string {
  if (score <= levels.low) return "Low";
  if (score <= levels.medium) return "Medium";
  if (score <= levels.high) return "High";
  return "Critical";
}

export function buildSummaryReportPdf(input: SummaryReportInput): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "LETTER", margin: 50, bufferPages: true });
  const { kpis, levels, highRiskLoads, edgeCases, detention } = input;

  header(doc, "RoadPilot Fleet Risk Summary", `Southern Ontario city dispatch  -  Generated ${input.generatedAt.toLocaleString("en-CA")}`);

  sectionTitle(doc, "Fleet KPIs");
  kvRow(doc, "Active loads", String(kpis.activeLoads));
  kvRow(doc, "Total drivers", String(kpis.totalDrivers));
  kvRow(doc, "Available drivers", String(kpis.availableDrivers));
  kvRow(doc, "High risk loads", String(kpis.highRiskLoads), { valueColor: COLORS.danger });

  if (input.riskProfile) {
    const { fleetAverage: f, highRiskAverage: h, fleetLegs, highRiskLegs } = input.riskProfile;
    sectionTitle(doc, "Fleet Risk Profile");
    radarCompare(
      doc,
      [
        {
          label: `Fleet average (${fleetLegs.toLocaleString()} legs)`,
          values: [f.hosRisk, f.delayRisk, f.detentionRisk, f.emptyMileRisk],
          color: COLORS.textMuted,
          dashed: true,
        },
        {
          label: `High-risk legs only (${highRiskLegs.toLocaleString()})`,
          values: [h.hosRisk, h.delayRisk, h.detentionRisk, h.emptyMileRisk],
          color: COLORS.danger,
        },
      ],
      { caption: "Which risk types actually separate the high-risk legs from the rest of the fleet." }
    );
  }

  sectionTitle(doc, `High Risk Loads (${highRiskLoads.length})`);
  if (highRiskLoads.length === 0) {
    doc.fontSize(10).font("Helvetica").fillColor(COLORS.textMuted).text("No loads above the High/Critical threshold right now.", 50, doc.y);
    doc.x = 50;
  } else {
    const colX = [50, 110, 180, 365, 465];
    const headerY = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.textSecondary);
    doc.text("Trip", colX[0], headerY, { width: 55, lineBreak: false });
    doc.text("Driver", colX[1], headerY, { width: 65, lineBreak: false });
    doc.text("Route", colX[2], headerY, { width: 180, lineBreak: false });
    doc.text("Score", colX[3], headerY, { width: 45, lineBreak: false });
    doc.text("Level", colX[4], headerY, { width: 60, lineBreak: false });
    doc.x = 50;
    doc.y = headerY + 14;
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    doc.y += 6;
    doc.x = 50;

    for (const row of highRiskLoads.slice(0, 25)) {
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
      }
      const rowY = doc.y;
      doc.fontSize(9).font("Helvetica").fillColor(COLORS.text);
      doc.text(String(row.TRIP_NUMBER), colX[0], rowY, { width: 55, lineBreak: false });
      doc.text(row.DRIVER_NAME, colX[1], rowY, { width: 65, lineBreak: false });
      doc.text(`${row.ORIG_ZONE_DESC} -> ${row.DEST_ZONE_DESC}`, colX[2], rowY, { width: 180, lineBreak: false });
      doc.fillColor(riskColor(row.riskScore, levels)).font("Helvetica-Bold").text(String(Math.round(row.riskScore)), colX[3], rowY, { width: 45, lineBreak: false });
      doc.fillColor(COLORS.text).font("Helvetica").text(row.level, colX[4], rowY, { width: 60, lineBreak: false });
      doc.x = 50;
      doc.y = rowY + 16;
    }
  }

  sectionTitle(doc, "Edge Case Discovery");
  kvRow(doc, "Already over HOS legal limit", String(edgeCases.counts.alreadyInViolation), { valueColor: COLORS.danger });
  kvRow(doc, "About to run out of HOS", String(edgeCases.counts.aboutToExhaust), { valueColor: COLORS.warning });
  kvRow(doc, "Chronic high-detention zones", String(edgeCases.counts.chronicDetentionZones));
  if (edgeCases.chronicDetentionZones.length > 0) {
    doc.moveDown(0.15);
    doc.fontSize(9).font("Helvetica-Oblique").fillColor(COLORS.textMuted).text(
      "Top zones: " + edgeCases.chronicDetentionZones.slice(0, 5).map((z) => `${z.zone} (${z.highDetentionLegs})`).join(", ")
    );
  }

  sectionTitle(doc, "Detention Billing");
  kvRow(doc, "Recovered revenue", `$${detention.totalDetentionFeesCAD.toLocaleString()} CAD`, { valueColor: COLORS.success });
  kvRow(doc, "Billable stops", String(detention.billableStops));
  if (detention.topCustomers.length > 0) {
    doc.moveDown(0.15);
    doc.fontSize(9).font("Helvetica-Oblique").fillColor(COLORS.textMuted).text(
      "Top locations: " + detention.topCustomers.slice(0, 5).map((c) => `${c.zone} ($${c.feeCAD.toLocaleString()})`).join(", ")
    );
  }

  footer(doc, "Risk-level boundaries and billing rates are configurable in Settings and reflect their values at generation time.");
  return doc;
}
