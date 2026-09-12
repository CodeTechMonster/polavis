/**
 * Route-condition-aware dispatcher recommendation. Separate from ai/recommendation-service.ts
 * (which explains the XGBoost Base Risk Score) -- this one is scoped to real-time traffic/weather
 * conditions and what to do about them operationally. Same MOCK_CLAUDE support as the existing
 * service, so this can be exercised end-to-end without a real ANTHROPIC_API_KEY.
 *
 * Model comes from ai/model-config.ts (Claude Opus 5 by default, overridable with ANTHROPIC_MODEL).
 */

import { MAX_TOKENS_ROUTE_CONDITIONS, OUTPUT_LIMITS, parseClaudeJson } from "./model-config.js";
import { callLlm } from "./llm-client.js";

export interface RouteRecommendationInput {
  tripNumber: number;
  driverName: string;
  origin: string;
  destination: string;
  baseRiskScore: number;
  trafficAdjustment: number;
  weatherAdjustment: number;
  adjustedRiskScore: number;
  trafficFactors: string[]; // human-readable, e.g. "Major collision on HWY 401 near Milton"
  weatherFactors: string[]; // e.g. "Heavy rain", "Visibility 500m"
}

export interface RouteRecommendationOutput {
  summary: string;
  recommendedActions: string[];
  source: "mock" | "live";
  provider?: "anthropic" | "spur";
  model?: string;
}

export async function getRouteRecommendation(
  input: RouteRecommendationInput,
  useSpur = false
): Promise<RouteRecommendationOutput> {
  if (process.env.MOCK_CLAUDE === "true") {
    const actions: string[] = [];
    if (input.trafficFactors.some((f) => /collision|closure/i.test(f))) {
      actions.push("Delay pickup by 30-45 minutes until the incident clears");
      actions.push("Consider an alternate route around the affected corridor");
    }
    if (input.trafficFactors.some((f) => /construction/i.test(f))) {
      actions.push("Build extra buffer time into the schedule for the construction zone");
    }
    if (input.weatherFactors.some((f) => /rain|snow|ice/i.test(f))) {
      actions.push("Assign an experienced driver if available, given current road conditions");
    }
    if (input.weatherFactors.some((f) => /visibility/i.test(f))) {
      actions.push("Advise the driver to reduce speed and increase following distance in low visibility");
    }
    actions.push("Monitor traffic and weather conditions before final dispatch");

    return {
      summary: `[MOCK] Trip ${input.tripNumber} (${input.origin} -> ${input.destination}): base risk ${input.baseRiskScore}, ` +
        `adjusted to ${input.adjustedRiskScore} after +${input.trafficAdjustment} traffic and +${input.weatherAdjustment} weather. ` +
        (input.trafficFactors[0] ? `${input.trafficFactors[0]}. ` : "") +
        (input.weatherFactors[0] ? `${input.weatherFactors[0]} expected along the corridor.` : ""),
      recommendedActions: actions,
      source: "mock",
    };
  }

  const systemPrompt = `You are RoadPilot's AI Dispatch Copilot, focused specifically on real-time route conditions (traffic and weather) for a Southern Ontario regional trucking operation. You are given a load's existing ML-based Base Risk Score plus real-time traffic and weather factors that are NOT part of that model. Ground every claim in the numbers and factors provided -- do not invent conditions that weren't given to you. Respond with STRICT JSON ONLY, no markdown fences, matching this shape:
{"summary": string, "recommendedActions": string[]}

HARD LENGTH LIMITS -- your reply must stay inside these or it will be truncated and unusable:
- "summary": at most ${OUTPUT_LIMITS.summaryChars} characters, 2-3 sentences.
- "recommendedActions": at most ${OUTPUT_LIMITS.maxActions} items, each at most ${OUTPUT_LIMITS.actionChars} characters (one sentence).
Output the JSON object and nothing else -- no preamble, no explanation, no markdown fences.
Keep recommendedActions operationally actionable and specific to the conditions given (e.g. reference the actual highway/corridor and condition, not generic advice).`;

  const userPrompt = `Trip ${input.tripNumber}, driver ${input.driverName}, route: ${input.origin} -> ${input.destination}
Base Risk Score (XGBoost, unchanged): ${input.baseRiskScore}
Traffic Adjustment: +${input.trafficAdjustment}
Weather Adjustment: +${input.weatherAdjustment}
Adjusted Risk Score: ${input.adjustedRiskScore}

Traffic factors:
${input.trafficFactors.map((f) => `- ${f}`).join("\n") || "- None reported"}

Weather factors:
${input.weatherFactors.map((f) => `- ${f}`).join("\n") || "- None reported"}`;

  const reply = await callLlm({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: MAX_TOKENS_ROUTE_CONDITIONS,
    useSpur,
  });

  const cleaned = parseClaudeJson<Omit<RouteRecommendationOutput, "source" | "provider" | "model">>(
    reply.text,
    reply.truncated,
    "Route conditions recommendation",
    ["summary", "recommendedActions"]
  );
  return { ...cleaned, source: "live", provider: reply.provider, model: reply.model };
}
