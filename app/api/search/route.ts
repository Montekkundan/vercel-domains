import { Vercel } from "@vercel/sdk";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const vercel = new Vercel({
  bearerToken: process.env.VERCEL_BEARER_TOKEN || "",
});

const LEADING_DOT_RE = /^\./;

function pickCandidateTlds(tlds: string[], limit = 50) {
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

// POST /api/search
// Body: { q?: string, teamId?: string }
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

    // Fetch supported TLDs once so we can build candidate domains
    const supported = await vercel.domainsRegistrar.getSupportedTlds({
      teamId,
    });
    const tlds: string[] = Array.isArray(supported)
      ? supported
          .map((t) => String(t).replace(LEADING_DOT_RE, ""))
          .filter(Boolean)
      : [];

    // If the user supplied a full domain (contains a dot), check availability for that domain only
    const looksLikeDomain = q.includes(".") && !q.includes(" ");

    let domainsToCheck: string[] = [];

    if (looksLikeDomain) {
      domainsToCheck = [normalizedQ];
    } else {
      const finalTlds = pickCandidateTlds(tlds, 50);
      domainsToCheck = finalTlds.map((t) => `${normalizedQ}.${t}`);
    }

    // Call bulk availability endpoint
    const availability = await vercel.domainsRegistrar.getBulkAvailability({
      teamId,
      requestBody: { domains: domainsToCheck },
    });

    return NextResponse.json({ domains: availability });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("/api/search error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
