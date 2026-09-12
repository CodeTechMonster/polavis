/**
 * One place that knows how to talk to a chat model, so the two AI services don't each need to
 * care which provider is active.
 *
 * Two providers with genuinely different wire formats:
 *
 *   Anthropic  POST /v1/messages          x-api-key + anthropic-version
 *              { model, max_tokens, system, messages }
 *              -> content[].text, stop_reason === "max_tokens" when cut off
 *
 *   SPUR AI    POST /v1/chat/completions  Authorization: Bearer
 *              { model, messages }  (system is a message with role "system")
 *              -> choices[0].message.content, finish_reason === "length" when cut off
 *
 * Callers get back the same shape either way, including a normalised `truncated` flag — the
 * truncation-recovery logic in model-config.ts depends on knowing that, and the two providers
 * signal it with different field names and different values.
 */

import { anthropicModel } from "./model-config.js";

export type LlmProvider = "anthropic" | "spur";

export interface LlmReply {
  text: string;
  truncated: boolean;
  provider: LlmProvider;
  model: string;
}

export const SPUR_DEFAULT_BASE_URL = "https://ai.spuric.com/v1";
export const SPUR_DEFAULT_MODEL = "spur-chat";

export function spurBaseUrl(): string {
  return process.env.SPUR_BASE_URL?.trim() || SPUR_DEFAULT_BASE_URL;
}

export function spurModel(): string {
  return process.env.SPUR_MODEL?.trim() || SPUR_DEFAULT_MODEL;
}

/**
 * Whether SPUR can actually be used right now.
 *
 * The Settings toggle alone isn't enough: someone can switch it on without ever putting a key in
 * .env, and silently falling back to Anthropic would make the toggle look broken. Callers use this
 * to give a specific error instead.
 */
export function spurConfigured(): boolean {
  const key = process.env.SPUR_API_KEY?.trim();
  return !!key && key.length > 0;
}

export async function callLlm(opts: {
  system: string;
  user: string;
  maxTokens: number;
  useSpur: boolean;
  timeoutMs?: number;
}): Promise<LlmReply> {
  const { system, user, maxTokens, useSpur } = opts;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 60_000);

  if (useSpur) {
    const key = process.env.SPUR_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "SPUR AI is enabled in Settings but SPUR_API_KEY is not set in backend/.env. " +
          "Add the key, or turn SPUR AI off to use Anthropic."
      );
    }
    const model = spurModel();
    const res = await fetch(`${spurBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`SPUR AI error ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error("SPUR AI returned no message content");
    }
    return {
      text,
      truncated: data?.choices?.[0]?.finish_reason === "length",
      provider: "spur",
      model,
    };
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = anthropicModel();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  }
  const data: any = await res.json();
  const block = data.content?.find((b: any) => b.type === "text");
  if (!block) throw new Error("No text content in Claude response");
  return {
    text: block.text,
    truncated: data.stop_reason === "max_tokens",
    provider: "anthropic",
    model,
  };
}
