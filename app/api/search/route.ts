import { gateway } from "@ai-sdk/gateway";
import { Vercel } from "@vercel/sdk";
import { generateText } from "ai";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const vercel = new Vercel({
  bearerToken: process.env.VERCEL_BEARER_TOKEN || "",
});

const LEADING_DOT_RE = /^\./;
const LABEL_CACHE_TTL = 1000 * 60 * 10;
const TLDS_CACHE_TTL = 1000 * 60 * 5;
const labelCache = new Map<string, { label: string; ts: number }>();
let tldsCache: { tlds: string[]; ts: number } | null = null;

const generateChatTitleInstructions =
  "Generate a short, brandable domain phrase (max 30 characters) inspired by the context. Make it sound like a real domain concept (e.g. reorder or merge words such as \"mydogparty\"), keep it lowercase, avoid quotes or special characters, and never append TLDs. If the context is vague, invent an appealing domainable idea.";

const SURROUNDING_QUOTE_RE = /^"|"$/g;
const LEADING_DOTS_RE = /^\.+/;
const WHITESPACE_RE = /\s+/;
const NON_LABEL_RE = /[^a-z0-9-]/g;
const TRIM_HYPHEN_RE = /^-+|-+$/g;

function domainLabelFromTitle(input: string) {
  if (!input) {
    return "";
  }

  let s = input.toLowerCase().trim();
  s = s.replace(SURROUNDING_QUOTE_RE, "");
  s = s.replace(LEADING_DOTS_RE, "");
  s = s.replace(WHITESPACE_RE, "");
  s = s.replace(NON_LABEL_RE, "");
  s = s.replace(TRIM_HYPHEN_RE, "");

  if (s.length > 63) {
    s = s.slice(0, 63);
  }

  return s;
}

async function getSearchLabelFromQuery(
  originalQ: string,
  normalizedQ: string,
  fallbackLabel = ""
) {
  const multiWord = WHITESPACE_RE.test(originalQ);
  if (!multiWord) {
    return normalizedQ;
  }

  const now = Date.now();
  const cached = labelCache.get(originalQ);
  if (cached && now - cached.ts < LABEL_CACHE_TTL) {
    return cached.label;
  }

  try {
    const prompt = `${generateChatTitleInstructions}\n\n<context>\n${originalQ.slice(0, 500)}\n</context>`;

    const { text: title } = await generateText({
      model: gateway("gpt-4.1-nano"),
      prompt,
      maxOutputTokens: 30,
    });

    const cleaned = (title || "").trim().replace(SURROUNDING_QUOTE_RE, "");
    const finalTitle =
      cleaned.length > 30 ? `${cleaned.slice(0, 27).trim()}...` : cleaned;
    const label = domainLabelFromTitle(finalTitle);
    if (label) {
      labelCache.set(originalQ, { label, ts: now });
      return label;
    }

    const fallback = normalizedQ.replace(WHITESPACE_RE, "") || fallbackLabel;
    labelCache.set(originalQ, { label: fallback, ts: now });
    return fallback;
  } catch (e) {
    console.error("AI title generation failed, falling back:", e);
    const fallback = normalizedQ.replace(WHITESPACE_RE, "") || fallbackLabel;
    labelCache.set(originalQ, { label: fallback, ts: now });
    return fallback;
  }
}

function pickCandidateTlds(tlds: string[], limit = 25) {
  const COMMON = [
    "com",
    "net",
    "org",
    "dev",
    "io",
    "app",
    "ai",
    "co",
    "xyz",
    "tech",
    "site",
    "online",
    "me",
    "info",
    "store",
  ];

  const preferred: string[] = [];
  for (const c of COMMON) {
    if (tlds.includes(c) && !preferred.includes(c)) {
      preferred.push(c);
    }
  }

  const rest = tlds.filter((t) => !preferred.includes(t));

  return [...preferred, ...rest].slice(0, limit);
}

function buildDomainsToCheck(
  looksLikeDomain: boolean,
  normalizedQ: string,
  searchLabel: string,
  tlds: string[]
) {
  if (looksLikeDomain) {
    return [normalizedQ];
  }

  const finalTlds = pickCandidateTlds(tlds, 25);
  return finalTlds.map((t) => `${searchLabel}.${t}`);
}

async function getSupportedTlds(teamId?: string) {
  const now = Date.now();
  if (tldsCache && now - tldsCache.ts < TLDS_CACHE_TTL) {
    return tldsCache.tlds;
  }

  const supported = await vercel.domainsRegistrar.getSupportedTlds({ teamId });
  const tlds: string[] = Array.isArray(supported)
    ? supported
        .map((t) => String(t).replace(LEADING_DOT_RE, ""))
        .filter(Boolean)
    : [];

  tldsCache = { tlds, ts: Date.now() };
  return tlds;
}

function bulkAvailability(teamId: string | undefined, domains: string[]) {
  return vercel.domainsRegistrar.getBulkAvailability({
    teamId,
    requestBody: { domains },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const q = typeof body.q === "string" ? body.q.trim().toLowerCase() : "";
    const teamId =
      typeof body.teamId === "string" && body.teamId ? body.teamId : undefined;

    if (!q) {
      return NextResponse.json({ domains: [] });
    }

    const normalizedQ = q.replace(LEADING_DOT_RE, "");

    const [searchLabel, tlds] = await Promise.all([
      getSearchLabelFromQuery(q, normalizedQ),
      getSupportedTlds(teamId),
    ]);

    const looksLikeDomain = q.includes(".") && !q.includes(" ");

    const domainsToCheck: string[] = buildDomainsToCheck(
      looksLikeDomain,
      normalizedQ,
      searchLabel,
      tlds
    );

    const availability = await bulkAvailability(teamId, domainsToCheck);

    return NextResponse.json({ domains: availability });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("/api/search error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
