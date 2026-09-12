/**
 * Single source of truth for which Claude model the two AI services call.
 *
 * Both ai/recommendation-service.ts and ai/route-recommendation-service.ts used to hardcode the
 * model string separately, which meant switching models required editing two files and they could
 * silently drift apart. They now both import DEFAULT_MODEL from here.
 *
 * Override at runtime with ANTHROPIC_MODEL in backend/.env — useful for falling back to a cheaper
 * or faster model for demos without touching code.
 */

// Claude Opus 5 — Anthropic's high-capability model, used here because dispatch recommendations
// involve multi-factor operational reasoning (HOS law + schedule + detention history + driver
// availability) where the quality of the tradeoff explanation matters more than latency.
export const DEFAULT_MODEL = "claude-opus-5";

export function anthropicModel(): string {
  const override = process.env.ANTHROPIC_MODEL?.trim();
  return override && override.length > 0 ? override : DEFAULT_MODEL;
}

/**
 * Token budgets for the two AI features.
 *
 * History: originally 700/1000 tuned against claude-sonnet-4-6; raised to 1500/2000 in v2.1.1 when
 * Opus 5 started overrunning them. Opus 5 still overran 1500 on route conditions in the field, so
 * the real fix is not just a bigger ceiling — the prompts now state hard length caps (see
 * OUTPUT_LIMITS below) so the model targets a bounded reply, and these budgets are set roughly 3x
 * the capped output as headroom rather than as a limit the model is expected to bump against.
 */
export const MAX_TOKENS_RECOMMENDATION = 3000;
export const MAX_TOKENS_ROUTE_CONDITIONS = 2500;

/**
 * Hard output caps stated to the model in the prompts. Keeping them here (rather than inline in
 * each prompt string) means the caps and the token budgets above are visible together, so raising
 * one without considering the other is less likely.
 *
 * These are deliberately generous enough for a genuinely useful dispatcher answer but small enough
 * that the full JSON is nowhere near the token budget.
 */
export const OUTPUT_LIMITS = {
  summaryChars: 400,
  actionChars: 160,
  maxActions: 5,
  planChars: 400,
  impactChars: 120,
};

/**
 * Best-effort repair of JSON that was cut off mid-generation.
 *
 * Rather than guessing a single cut point, this walks the text recording every position where the
 * structure was "settled" (not mid-string, not mid-token) together with the bracket stack at that
 * moment, then tries those candidates newest-first: close the open brackets and see if it parses.
 * The first one that parses wins, so a reply truncated inside `recommendedActions` still yields the
 * summary plus the actions that did complete, and a reply truncated on a dangling key
 * (`..., "recommendedActions"`) falls back to the last point that actually parses.
 *
 * Backtracking is used instead of one clever cut because the failure shapes vary (mid-string,
 * mid-key, trailing comma, nested object) and a single rule got several of them wrong in testing.
 *
 * Returns null when there's nothing coherent to recover.
 */
export function salvageTruncatedJson(text: string): string | null {
  // Candidate cut points: [indexToCutAt, closersNeeded]
  const candidates: [number, string[]][] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  const record = (i: number) => candidates.push([i, [...stack]]);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        record(i + 1); // just past a closed string (may be a key or a value — we try both)
      }
      continue;
    }

    if (c === '"') { inString = true; continue; }

    if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
      record(i + 1);
    } else if (c === "}" || c === "]") {
      stack.pop();
      record(i + 1);
    } else if (c === "," || c === ":") {
      record(i + 1);
    }
  }

  for (let k = candidates.length - 1; k >= 0; k--) {
    const [cut, closers] = candidates[k];
    if (closers.length === 0) continue; // nothing open -> nothing to repair here

    let out = text.slice(0, cut).trimEnd();
    // Drop a trailing separator; a dangling key that never got a value simply fails to parse here
    // and the loop falls back to an earlier candidate.
    while (out.endsWith(",") || out.endsWith(":")) out = out.slice(0, -1).trimEnd();

    for (let j = closers.length - 1; j >= 0; j--) out += closers[j];

    try {
      const parsed = JSON.parse(out);
      // Only accept objects/arrays — a bare salvaged scalar isn't a usable reply.
      if (parsed && typeof parsed === "object") return out;
    } catch {
      // try the next-earlier candidate
    }
  }

  return null;
}

/**
 * Parses a Claude JSON reply, turning the two common failure modes into errors that actually say
 * what went wrong instead of surfacing a raw JSON.parse() message to the dispatcher.
 *
 * `stopReason` comes from the API response's `stop_reason`. When it's "max_tokens" the model was
 * cut off mid-sentence, so the JSON is invalid — but rather than failing the whole request we first
 * try to salvage the complete fields (see salvageTruncatedJson). `requiredFields` decides whether
 * what we recovered is actually usable; if it isn't, we fall through to a clear error.
 */
export function parseClaudeJson<T>(
  rawText: string,
  truncated: boolean,
  context: string,
  requiredFields: (keyof T)[] = []
): T {
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through to salvage
  }

  const repaired = salvageTruncatedJson(cleaned);
  if (repaired) {
    try {
      const parsed = JSON.parse(repaired) as T;
      const hasAll = requiredFields.every((f) => {
        const v = (parsed as any)[f];
        return v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0);
      });
      if (hasAll) {
        console.warn(
          `[${context}] The model's reply was cut off; ` +
            `recovered the complete fields and continued. Consider raising the token budget in ai/model-config.ts.`
        );
        return parsed;
      }
    } catch {
      // salvage didn't produce valid JSON either — fall through to the error below
    }
  }

  if (truncated) {
    throw new Error(
      `${context}: the model's reply hit the max_tokens limit and was cut off too early to recover ` +
        `anything usable. Raise the token budget in backend/ai/model-config.ts (currently ` +
        `${MAX_TOKENS_RECOMMENDATION}/${MAX_TOKENS_ROUTE_CONDITIONS}), or set MOCK_CLAUDE=true to demo without the API.`
    );
  }

  const preview = cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
  throw new Error(
    `${context}: the model returned text that isn't valid JSON. Received ${cleaned.length} chars starting: ${preview}`
  );
}

// ---------------------------------------------------------------------------
// Provider selection: Anthropic (default) or SPUR AI
// ---------------------------------------------------------------------------
//
// SPUR is opt-in from Settings and off by default, so nothing changes unless a
// dispatcher deliberately turns it on.
//
// ASSUMPTION worth knowing about: SPUR is called as an OpenAI-compatible chat-completions
// endpoint (POST {base}/chat/completions, Bearer auth, choices[0].message.content). That is what
// a `/v1` base with `sk-` keys almost always means, but it was NOT verified against SPUR's live
// API — this environment cannot reach ai.spuric.com. If SPUR turns out to use a different shape,
// the change is confined to callSpur() below. SPUR_API_BASE and SPUR_MODEL are env-overridable so
// a different path or model name needs no code change.
export const SPUR_DEFAULT_BASE = "https://ai.spuric.com/v1";
export const SPUR_DEFAULT_MODEL = "spur-1";

export function spurBase(): string {
  return (process.env.SPUR_API_BASE?.trim() || SPUR_DEFAULT_BASE).replace(/\/+$/, "");
}
export function spurModel(): string {
  return process.env.SPUR_MODEL?.trim() || SPUR_DEFAULT_MODEL;
}
export function spurKey(): string {
  return process.env.SPUR_API_KEY?.trim() ?? "";
}

export interface LlmOptions {
  useSpur?: boolean;
  maxTokens: number;
  system: string;
  user: string;
  context: string;
}

export interface LlmResult {
  text: string;
  stopReason: string | undefined;
  provider: "anthropic" | "spur";
}

async function callAnthropic(o: LlmOptions): Promise<LlmResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY?.trim() ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: anthropicModel(),
      max_tokens: o.maxTokens,
      system: o.system,
      messages: [{ role: "user", content: o.user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = data.content?.find((b: any) => b.type === "text");
  if (!block) throw new Error("No text content in Claude response");
  return { text: block.text, stopReason: data.stop_reason, provider: "anthropic" };
}

async function callSpur(o: LlmOptions): Promise<LlmResult> {
  if (!spurKey()) {
    throw new Error(
      "SPUR AI is enabled in Settings but SPUR_API_KEY is not set in backend/.env. " +
        "Add the key, or turn SPUR off in Settings to fall back to Claude."
    );
  }
  const res = await fetch(`${spurBase()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${spurKey()}` },
    body: JSON.stringify({
      model: spurModel(),
      max_tokens: o.maxTokens,
      messages: [
        // OpenAI-style: the system prompt is the first message rather than a separate field.
        { role: "system", content: o.system },
        { role: "user", content: o.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`SPUR API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text) {
    throw new Error(
      `SPUR returned no message content. If SPUR is not OpenAI-compatible, adjust callSpur() in ` +
        `ai/model-config.ts. Response keys: ${Object.keys(data ?? {}).join(", ") || "(none)"}`
    );
  }
  // OpenAI reports truncation as finish_reason "length"; normalise it to Anthropic's wording so
  // parseClaudeJson()'s truncation handling works identically for both providers.
  const finish = choice?.finish_reason;
  return { text, stopReason: finish === "length" ? "max_tokens" : finish, provider: "spur" };
}

/** Single entry point for both AI features, so provider choice lives in one place. */
export async function callLlm(o: LlmOptions): Promise<LlmResult> {
  return o.useSpur ? callSpur(o) : callAnthropic(o);
}
