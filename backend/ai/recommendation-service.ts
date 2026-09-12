/**
 * RoadPilot AI Dispatch Advisor — Claude AI Recommendation Engine
 * Takes risk scores + SHAP output + driver/route/load context and asks Claude
 * to produce a structured operational recommendation.
 *
 * Requires ANTHROPIC_API_KEY in the environment. Model comes from ai/model-config.ts
 * (Claude Opus 5 by default, overridable with ANTHROPIC_MODEL).
 */

import { MAX_TOKENS_RECOMMENDATION, OUTPUT_LIMITS, parseClaudeJson } from "./model-config.js";
import { callLlm } from "./llm-client.js";

export interface RiskInput {
  tripNumber: number;
  driverName: string;
  origin: string;
  destination: string;
  riskScore: number;
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
}

export interface ShapFactor {
  friendly_name: string;
  value: number;
  direction: "increases risk" | "decreases risk";
}

export interface RouteConditionsSummary {
  baseRiskScore: number;
  trafficAdjustment: number;
  weatherAdjustment: number;
  adjustedRiskScore: number;
  routeConditionFactors: string[];
}

export interface RecommendationOutput {
  summary: string;
  risks: string[];
  recommendations: string[];
  alternativeDispatchPlan: string;
  expectedImpact: {
    riskReduction: string;
    detentionSavings: string;
    delayReduction: string;
  };
  source?: "mock" | "live"; // present so the UI can be honest about which path produced this
  // Which provider actually answered. Shown in the UI so "we switched to SPUR" is verifiable
  // rather than something the dispatcher has to take on trust.
  provider?: "anthropic" | "spur";
  model?: string;
}

const SYSTEM_PROMPT = `You are RoadPilot's AI Dispatch Copilot for a Southern Ontario regional
trucking operation (hubs: London ON and Milton ON). You are given a risk-scored dispatch leg,
its top SHAP contributing factors, a candidate replacement driver if one is available, and —
if the dispatcher has already run a real-time Route Conditions analysis for this leg — the
resulting traffic/weather adjustments on top of the base score. The base risk score comes from
the XGBoost model; the route conditions data (if present) is real-time and separate from it, not
part of the model's own reasoning. Respond with STRICT JSON ONLY, matching this shape exactly, no
markdown fences, no preamble:
{
  "summary": string,
  "risks": string[],
  "recommendations": string[],
  "alternativeDispatchPlan": string,
  "expectedImpact": {
    "riskReduction": string,
    "detentionSavings": string,
    "delayReduction": string
  }
}
Ground every claim in the numbers provided. If route conditions data is present, factor the
specific traffic/weather factors into your summary and recommendations (e.g. reference the actual
adjusted score and the real corridor conditions) rather than ignoring it.

HARD LENGTH LIMITS -- your reply must stay inside these or it will be truncated and unusable:
- "summary": at most ${OUTPUT_LIMITS.summaryChars} characters.
- "risks" and "recommendations": at most ${OUTPUT_LIMITS.maxActions} items each, every item at most ${OUTPUT_LIMITS.actionChars} characters (one sentence).
- "alternativeDispatchPlan": at most ${OUTPUT_LIMITS.planChars} characters.
- each "expectedImpact" value: at most ${OUTPUT_LIMITS.impactChars} characters.
Output the JSON object and nothing else -- no preamble, no explanation, no markdown fences.

Use CAD for any dollar figures and reference the brief's known industry cost range
($1,000-$7,000 per missed load, $15,000-$50,000/month per dispatch desk) only if it is genuinely
relevant to this leg.`;

export async function getRecommendation(
  risk: RiskInput,
  shapFactors: ShapFactor[],
  candidateDriver?: { name: string; remainingHoursCan7: number; distanceToPickupKm: number },
  routeConditions?: RouteConditionsSummary,
  // Comes from the persisted Settings toggle rather than an env var, so a dispatcher can switch
  // providers without restarting the backend.
  useSpur = false
): Promise<RecommendationOutput> {
  // --- MOCK MODE: set MOCK_CLAUDE=true in backend/.env to exercise the full button-click ->
  // JSON -> UI flow without a real ANTHROPIC_API_KEY. Built from the same real risk/SHAP/candidate
  // inputs as the live call below (not hardcoded text), so different trips still look different.
  // Nothing below this block is touched — this is purely an early return added on top.
  if (process.env.MOCK_CLAUDE === "true") {
    const topFactor = shapFactors[0];
    const dispatchPlan = candidateDriver
      ? `Reassign to ${candidateDriver.name} (${candidateDriver.remainingHoursCan7}h HOS remaining, ${candidateDriver.distanceToPickupKm}km from pickup).`
      : "No candidate driver was pre-selected — check the What-if panel for nearby available drivers with sufficient HOS.";
    const routeNote = routeConditions
      ? ` Real-time route conditions add +${routeConditions.trafficAdjustment} traffic and +${routeConditions.weatherAdjustment} weather, adjusting the score to ${routeConditions.adjustedRiskScore}${routeConditions.routeConditionFactors[0] ? ` (${routeConditions.routeConditionFactors[0]})` : ""}.`
      : "";
    return {
      summary: `[MOCK] Trip ${risk.tripNumber} (${risk.driverName}, ${risk.origin} -> ${risk.destination}) has an overall risk score of ${risk.riskScore}.` +
        (topFactor ? ` The largest contributing factor is ${topFactor.friendly_name} (${topFactor.direction}).` : "") +
        routeNote,
      risks: [
        `hosRisk=${risk.hosRisk}, delayRisk=${risk.delayRisk}, detentionRisk=${risk.detentionRisk}, emptyMileRisk=${risk.emptyMileRisk}`,
        ...(routeConditions ? [`Route conditions: ${routeConditions.routeConditionFactors.slice(0, 3).join("; ") || "none reported"}`] : []),
        "This is a mock response for local testing -- not a real Claude API call.",
      ],
      recommendations: [
        dispatchPlan,
        "Verify dock arrival/departure timestamps if detentionRisk is the main driver.",
        ...(routeConditions && routeConditions.trafficAdjustment + routeConditions.weatherAdjustment > 0
          ? ["Re-check the route conditions closer to dispatch time, since they can change."]
          : []),
      ],
      alternativeDispatchPlan: dispatchPlan,
      expectedImpact: {
        riskReduction: "N/A (mock -- set MOCK_CLAUDE=false and add a real ANTHROPIC_API_KEY for a live estimate)",
        detentionSavings: "N/A (mock)",
        delayReduction: "N/A (mock)",
      },
      source: "mock",
    };
  }

  const userPrompt = `
Dispatch leg: trip ${risk.tripNumber}, driver ${risk.driverName}, ${risk.origin} -> ${risk.destination}
Risk scores (0-100): overall=${risk.riskScore}, hos=${risk.hosRisk}, delay=${risk.delayRisk}, detention=${risk.detentionRisk}, emptyMile=${risk.emptyMileRisk}

Top SHAP factors:
${shapFactors.map(f => `- ${f.friendly_name}: ${f.value} (${f.direction})`).join("\n")}

${candidateDriver
  ? `Candidate replacement driver: ${candidateDriver.name}, ${candidateDriver.remainingHoursCan7}h remaining (7-day cycle), ${candidateDriver.distanceToPickupKm}km from pickup.`
  : "No pre-identified replacement driver — suggest what to look for."}

${routeConditions
  ? `Real-time Route Conditions analysis has already been run for this leg:
Base Risk Score: ${routeConditions.baseRiskScore}
Traffic Adjustment: +${routeConditions.trafficAdjustment}
Weather Adjustment: +${routeConditions.weatherAdjustment}
Adjusted Risk Score: ${routeConditions.adjustedRiskScore}
Route condition factors:
${routeConditions.routeConditionFactors.length ? routeConditions.routeConditionFactors.map(f => `- ${f}`).join("\n") : "- None reported"}`
  : "No Route Conditions analysis has been run for this leg yet — base your recommendation on the model's risk score alone."}
`.trim();

  const reply = await callLlm({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: MAX_TOKENS_RECOMMENDATION,
    useSpur,
  });

  const parsed = parseClaudeJson<RecommendationOutput>(
    reply.text,
    reply.truncated,
    "Risk recommendation",
    ["summary", "recommendations"]
  );
  return { ...parsed, source: "live", provider: reply.provider, model: reply.model };
}
