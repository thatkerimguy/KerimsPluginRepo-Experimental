/*
 * HTTP for the resolvers: a few requests at a time per host, one request for
 * several callers asking for the same URL, and retries with backoff on 429 / 5xx
 * (respecting Retry-After). The platform passes the actual fetch: React Native's
 * fetch on mobile, a native.ts bridge on desktop (no CORS there either).
 */

export interface FetchResponse {
    status: number;
    /** Final URL after redirects. */
    url: string;
    headers: { get(name: string): string | null; };
    text(): Promise<string>;
}

export interface FetchInit {
    method?: "GET" | "HEAD";
    headers?: Record<string, string>;
}

export type Fetcher = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export class HttpError extends Error {
    readonly status: number;
    readonly url: string;
    constructor(status: number, url: string, message?: string) {
        super(message ?? `HTTP ${status} for ${url}`);
        this.name = "HttpError";
        this.status = status;
        this.url = url;
    }
}

/** The response wasn't in the expected shape (the site changed): counts against the resolver's health. */
export class ParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ParseError";
    }
}

/** The post doesn't exist, is private or was deleted. Not a resolver failure. */
export class NotFoundError extends Error {
    constructor(message = "Post not found") {
        super(message);
        this.name = "NotFoundError";
    }
}

export interface ClientOptions {
    /** Requests running at once per host. */
    perHost?: number;
    /** Delays before each retry, in ms. */
    retryDelays?: number[];
    /** Longest Retry-After honoured, in ms (longer ones fail at once). */
    maxRetryAfter?: number;
    /** Request timeout, ms. */
    timeout?: number;
    /** Injected for tests. */
    sleep?: (ms: number) => Promise<void>;
    userAgent?: string;
}

export interface HttpClient {
    getText(url: string, headers?: Record<string, string>): Promise<{ text: string; url: string; }>;
    getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
    /** Follows redirects and returns the final URL (short links). */
    resolveRedirect(url: string): Promise<string>;
}

const DEFAULTS = {
    perHost: 2,
    retryDelays: [1000, 3000],
    maxRetryAfter: 10_000,
    timeout: 15_000,
};

const hostOf = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1].toLowerCase() ?? "";

class HostGate {
    private running = 0;
    private readonly waiting: (() => void)[] = [];
    private readonly limit: number;
    constructor(limit: number) {
        this.limit = limit;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.running >= this.limit) await new Promise<void>(r => this.waiting.push(r));
        this.running++;
        try {
            return await task();
        } finally {
            this.running--;
            this.waiting.shift()?.();
        }
    }
}

function retryAfterMs(res: FetchResponse): number | null {
    const raw = res.headers.get("retry-after");
    if (!raw) return null;
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

const retryable = (status: number) => status === 429 || status === 408 || (status >= 500 && status <= 599);

export function createHttpClient(fetcher: Fetcher, options: ClientOptions = {}): HttpClient {
    const opts = { ...DEFAULTS, ...options };
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const gates = new Map<string, HostGate>();
    const inFlight = new Map<string, Promise<{ text: string; url: string; }>>();

    const gate = (url: string) => {
        const host = hostOf(url);
        let g = gates.get(host);
        if (!g) gates.set(host, g = new HostGate(opts.perHost));
        return g;
    };

    const withTimeout = <T,>(p: Promise<T>, url: string) => new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new HttpError(0, url, `Timed out after ${opts.timeout} ms: ${url}`)), opts.timeout);
        p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });

    async function attempt(url: string, init: FetchInit): Promise<{ text: string; url: string; }> {
        for (let i = 0; ; i++) {
            let wait: number | null = null;
            try {
                const res = await gate(url).run(() => withTimeout(fetcher(url, init), url));
                if (res.status >= 200 && res.status < 300) {
                    return { text: init.method === "HEAD" ? "" : await res.text(), url: res.url || url };
                }
                if (res.status === 404 || res.status === 410) throw new NotFoundError(`HTTP ${res.status} for ${url}`);
                if (!retryable(res.status)) throw new HttpError(res.status, url);
                wait = retryAfterMs(res);
                if (wait !== null && wait > opts.maxRetryAfter) throw new HttpError(res.status, url, `Rate limited for ${Math.round(wait / 1000)} s: ${url}`);
                if (i >= opts.retryDelays.length) throw new HttpError(res.status, url);
            } catch (e) {
                // Network errors (TypeError from fetch) and timeouts are retried; everything else is final
                const network = !(e instanceof HttpError || e instanceof NotFoundError) || (e instanceof HttpError && e.status === 0);
                if (!network || i >= opts.retryDelays.length) throw e;
            }
            await sleep(Math.max(wait ?? 0, opts.retryDelays[i]));
        }
    }

    function request(url: string, init: FetchInit): Promise<{ text: string; url: string; }> {
        const key = `${init.method ?? "GET"} ${url} ${JSON.stringify(init.headers ?? {})}`;
        const existing = inFlight.get(key);
        if (existing) return existing;
        const p = attempt(url, init).finally(() => inFlight.delete(key));
        inFlight.set(key, p);
        return p;
    }

    const headersFor = (extra?: Record<string, string>) => ({
        ...(opts.userAgent ? { "User-Agent": opts.userAgent } : {}),
        ...extra,
    });

    return {
        getText: (url, headers) => request(url, { headers: headersFor(headers) }),
        async getJson<T>(url: string, headers?: Record<string, string>) {
            const { text } = await request(url, { headers: headersFor({ Accept: "application/json", ...headers }) });
            try {
                return JSON.parse(text) as T;
            } catch {
                throw new ParseError(`Not JSON: ${url}`);
            }
        },
        async resolveRedirect(url: string) {
            return (await request(url, { method: "HEAD", headers: headersFor() })).url;
        },
    };
}
