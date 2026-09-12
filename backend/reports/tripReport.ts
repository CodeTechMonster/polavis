import PDFDocument from "pdfkit";
import { header, sectionTitle, kvRow, bulletList, riskColor, radarChart, radarCompare, footer, COLORS } from "./pdfStyle.js";

export interface TripReportInput {
  trip: { tripNumber: number; driverName: string; origin: string; destination: string };
  risk: { riskScore: number; hosRisk: number; delayRisk: number; detentionRisk: number; emptyMileRisk: number };
  levels: { low: number; medium: number; high: number };
  shapFactors: { feature: string; friendly_name: string; value: number; direction: string }[];
  whatIf?: {
    candidateName: string;
    // Sub-scores are optional: a client that only sends riskScore still produces a valid report,
    // just without the comparison radar.
    before: { riskScore: number; hosRisk?: number; delayRisk?: number; detentionRisk?: number; emptyMileRisk?: number };
    after: { riskScore: number; hosRisk?: number; delayRisk?: number; detentionRisk?: number; emptyMileRisk?: number };
    note: string;
  };
  routeConditions?: {
    baseRiskScore: number;
    trafficAdjustment: number;
    weatherAdjustment: number;
    adjustedRiskScore: number;
    routeConditionFactors: string[];
    recommendation: { summary: string; recommendedActions: string[] };
    dataSource: "mock" | "live";
  };
}

function levelLabel(score: number, levels: { low: number; medium: number; high: number }): string {
  if (score <= levels.low) return "Low";
  if (score <= levels.medium) return "Medium";
  if (score <= levels.high) return "High";
  return "Critical";
}

export function buildTripReportPdf(input: TripReportInput): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "LETTER", margin: 50, bufferPages: true });
  const { trip, risk, levels, shapFactors, whatIf, routeConditions } = input;

  header(
    doc,
    `Trip ${trip.tripNumber} Risk Report`,
    `${trip.driverName}  -  ${trip.origin} -> ${trip.destination}  -  Generated ${new Date().toLocaleString("en-CA")}`
  );

  sectionTitle(doc, "Base Risk Score (XGBoost)");
  const overallColor = riskColor(risk.riskScore, levels);
  doc.fontSize(28).font("Helvetica-Bold").fillColor(overallColor).text(String(Math.round(risk.riskScore)), doc.x, doc.y, { continued: true });
  doc.fontSize(12).font("Helvetica").fillColor(COLORS.textSecondary).text(`  / 100  (${levelLabel(risk.riskScore, levels)})`, { continued: false });
  doc.x = 50;
  doc.moveDown(0.6);
  kvRow(doc, "HOS Risk", String(Math.round(risk.hosRisk)));
  kvRow(doc, "Delay Risk", String(Math.round(risk.delayRisk)));
  kvRow(doc, "Detention Risk", String(Math.round(risk.detentionRisk)));
  kvRow(doc, "Empty-Mile Risk", String(Math.round(risk.emptyMileRisk)));

  doc.moveDown(0.3);
  radarChart(doc, risk);

  sectionTitle(doc, "Top SHAP Factors (Model Explanation)");
  if (shapFactors.length === 0) {
    doc.fontSize(10).font("Helvetica").fillColor(COLORS.textMuted).text("No SHAP explanation available for this trip.");
  } else {
    for (const f of shapFactors) {
      const arrow = f.direction === "increases risk" ? "^" : "v";
      const color = f.direction === "increases risk" ? COLORS.danger : COLORS.success;
      const y = doc.y;
      doc.fontSize(10).font("Helvetica").fillColor(COLORS.text).text(f.friendly_name, 50, y, { continued: true, width: 300 });
      doc.font("Helvetica-Bold").fillColor(color).text(`  ${arrow} ${Math.abs(Math.round(f.value))}`, { continued: false });
      doc.x = 50;
      doc.moveDown(0.2);
    }
  }

  if (whatIf) {
    sectionTitle(doc, "What-If: Reassignment Considered");
    kvRow(doc, "Candidate driver", whatIf.candidateName);
    kvRow(doc, "Risk before", String(Math.round(whatIf.before.riskScore)));
    kvRow(
      doc,
      "Risk after",
      String(Math.round(whatIf.after.riskScore)),
      { valueColor: whatIf.after.riskScore < whatIf.before.riskScore ? COLORS.success : COLORS.warning }
    );
    const hasSubScores =
      whatIf.before.hosRisk !== undefined && whatIf.after.hosRisk !== undefined;
    if (hasSubScores) {
      doc.moveDown(0.3);
      radarCompare(
        doc,
        [
          {
            label: `Current driver (${trip.driverName})`,
            values: [
              whatIf.before.hosRisk!, whatIf.before.delayRisk!,
              whatIf.before.detentionRisk!, whatIf.before.emptyMileRisk!,
            ],
            color: COLORS.textMuted,
            dashed: true,
          },
          {
            label: `Candidate (${whatIf.candidateName})`,
            values: [
              whatIf.after.hosRisk!, whatIf.after.delayRisk!,
              whatIf.after.detentionRisk!, whatIf.after.emptyMileRisk!,
            ],
            color: COLORS.accent,
          },
        ],
        { caption: "The combined score is a weighted average, so one axis can worsen while the total improves." }
      );
    }
    doc.fontSize(9).font("Helvetica-Oblique").fillColor(COLORS.textMuted).text(whatIf.note);
  }

  if (routeConditions) {
    sectionTitle(doc, "Route Conditions Analysis");
    if (routeConditions.dataSource === "mock") {
      doc.fontSize(8).font("Helvetica-Oblique").fillColor(COLORS.warning)
        .text("Mock data (MOCK_ROUTE_CONDITIONS=true) -- not live Ontario 511 / OpenWeather data");
      doc.moveDown(0.15);
    }
    kvRow(doc, "Base Risk Score", String(routeConditions.baseRiskScore));
    kvRow(doc, "Traffic Adjustment", `+${routeConditions.trafficAdjustment}`, { valueColor: COLORS.warning });
    kvRow(doc, "Weather Adjustment", `+${routeConditions.weatherAdjustment}`, { valueColor: COLORS.accent2 });
    kvRow(doc, "Adjusted Risk Score", String(routeConditions.adjustedRiskScore), { valueColor: COLORS.accent });
    doc.moveDown(0.2);

    doc.fontSize(10).font("Helvetica-Bold").fillColor(COLORS.text).text("AI Recommendation");
    doc.moveDown(0.1);
    doc.fontSize(10).font("Helvetica").fillColor(COLORS.text).text(routeConditions.recommendation.summary);
    doc.moveDown(0.15);
    bulletList(doc, routeConditions.recommendation.recommendedActions, COLORS.textSecondary);
  }

  footer(doc, "Risk thresholds and billing rates are configurable in Settings and reflect their values at generation time.");
  return doc;
}
