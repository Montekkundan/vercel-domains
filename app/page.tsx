"use client";

import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const WS_SPLIT = /\s+/;
export type DomainResult =
  | string
  | {
      domain?: string;
      name?: string;
      domainName?: string;
      available?: boolean;
      status?: string;
      [k: string]: unknown;
    };

export function normalizeDomainPayload(payload: unknown): DomainResult[] {
  if (Array.isArray(payload)) {
    return payload as DomainResult[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.results,
    obj.domains,
    obj.domains && typeof obj.domains === "object"
      ? (obj.domains as Record<string, unknown>).results
      : undefined,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c as DomainResult[];
    }
  }

  return [payload as DomainResult];
}

export default function Home() {
  const [q, setQ] = useState("");

  const searchCacheRef = useRef<
    Map<string, { results: DomainResult[]; ts: number }>
  >(new Map());
  const SEARCH_CACHE_TTL = 1000 * 60 * 2;

  const [results, setResults] = useState<DomainResult[]>([]);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const TOP_SKELETON_KEYS = ["t1", "t2", "t3", "t4"] as const;
  const ROW_SKELETON_KEYS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;

  const fetchDomains = useCallback(
    async (query: string, signal?: AbortSignal): Promise<DomainResult[]> => {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: query }),
          signal,
        });
        const data = await res.json();
        const payload = data?.domains ?? data ?? [];
        return normalizeDomainPayload(payload);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return [];
        }
        console.error("fetchDomains error", err);
        return [];
      }
    },
    []
  );

  const runSearch = useCallback(
    async (original: string, controller: AbortController) => {
      const now = Date.now();

      function getCachedSearch(s: string) {
        const c = searchCacheRef.current.get(s);
        if (c && now - c.ts < SEARCH_CACHE_TTL) {
          return c.results;
        }
        return undefined as DomainResult[] | undefined;
      }

      const updateUrl = (s: string) => {
        try {
          const url = new URL(window.location.href);
          if (s) {
            url.searchParams.set("q", s);
          } else {
            url.searchParams.delete("q");
          }
          window.history.replaceState(null, "", url.pathname + url.search);
        } catch {}
      };

      const cached = getCachedSearch(original);
      if (cached) {
        setResults(cached);
        setLoading(false);
        updateUrl(original);
        return;
      }

      const r = await fetchDomains(original, controller.signal);
      searchCacheRef.current.set(original, { results: r, ts: Date.now() });
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
      }
      setResults(r);

      setLoading(false);
      updateUrl(original);
    },
    [fetchDomains]
  );

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const paramQ = params.get("q") ?? "";
      if (paramQ) {
        setQ(paramQ);
      }
    } catch {}
    const onClear = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
        fetchAbortRef.current = null;
      }
      setQ("");
      setResults([]);
      setLoading(false);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("q");
        window.history.replaceState(null, "", url.pathname + url.search);
      } catch {}
    };

    window.addEventListener("inputgroup:clear", onClear);
    return () => window.removeEventListener("inputgroup:clear", onClear);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!q) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
        fetchAbortRef.current = null;
      }
      setResults([]);
      setLoading(false);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("q");
        window.history.replaceState(null, "", url.pathname + url.search);
      } catch {}
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      runSearch(q, controller).catch(() => {
        setLoading(false);
      });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [q, runSearch]);

  function getStatus(item: DomainResult) {
    if (typeof item === "object") {
      if (item.available === true) {
        return "Available";
      }
      if (item.available === false) {
        return "Registered";
      }
      if (item.status) {
        return item.status;
      }
    }
    return "";
  }

  function getDomainString(item: DomainResult) {
    if (typeof item === "string") {
      return item;
    }
    return (
      item?.domain ?? item?.name ?? item?.domainName ?? JSON.stringify(item)
    );
  }

  function DomainCard({ item }: { item: DomainResult }) {
    const domain = getDomainString(item);
    const status = getStatus(item);

    return (
      <div className="rounded border border-zinc-100 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="mb-2 font-semibold text-sm">{domain}</div>
        <div className="text-xs text-zinc-500">{status}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between bg-white px-16 py-32 sm:items-start dark:bg-black">
        <div className="grid w-full gap-6">
          <InputGroup>
            <InputGroupInput
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const v = e.target.value;
                setQ(v);
              }}
              placeholder="Search supported TLDs (eg: .com or com)..."
              value={q}
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <Kbd>Esc</Kbd>
            </InputGroupAddon>
          </InputGroup>

          <div>
            {loading && (
              <div>
                <div className="mb-4">
                  <h3 className="mb-2 font-medium text-sm">Top Results</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                    {TOP_SKELETON_KEYS.map((k) => (
                      <div
                        className="rounded border border-zinc-100 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-black"
                        key={k}
                      >
                        <Skeleton className="mb-2 h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 font-medium text-sm">All Results</h3>
                  <div className="overflow-hidden rounded-md border bg-white dark:bg-black">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Domain</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ROW_SKELETON_KEYS.map((k) => (
                          <TableRow key={k}>
                            <TableCell>
                              <Skeleton className="h-4 w-3/4" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-3 w-1/3" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}

            {!(loading || q) && (
              <div className="text-sm text-zinc-500">
                Start typing to search supported TLDs.
              </div>
            )}

            {!loading && q && results.length === 0 && (
              <div className="text-sm text-zinc-500">
                No matching domains found.
              </div>
            )}

            {!loading && results.length > 0 && (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-medium text-sm">Top Results</h3>
                  {q ? (
                    <Button asChild size="sm">
                      <a
                        aria-label={`Search ${q} on Vercel`}
                        href={vercelSearchUrl(q)}
                        rel="noopener"
                        target="_blank"
                      >
                        Open in Vercel
                      </a>
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                  {results.slice(0, 4).map((item) => (
                    <DomainCard item={item} key={getDomainString(item)} />
                  ))}
                </div>

                <div>
                  <h3 className="mb-2 font-medium text-sm">All Results</h3>
                  <div className="overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Domain</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.map((item) => {
                          const domain = getDomainString(item);
                          const status = getStatus(item);

                          return (
                            <TableRow key={domain}>
                              <TableCell className="text-sm">
                                {domain}
                              </TableCell>
                              <TableCell className="text-sm text-zinc-500">
                                {status}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function vercelSearchUrl(q: string) {
  const normalized = q.trim().split(WS_SPLIT).map(encodeURIComponent).join("+");
  return `https://vercel.com/domains/search?q=${normalized}`;
}
