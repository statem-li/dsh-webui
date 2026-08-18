/**
 * `AnySearchSearchProvider`: a `WebSearchProvider` backed by the AnySearch
 * unified search API (`POST /v1/search`). It maps each result's
 * `title`/`url`/`snippet` into the normalized source shape and omits `content`
 * because AnySearch returns per-result body content, not a generated answer.
 * @module dsh-web-search-anysearch/provider
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { CredentialRef } from '@deepseek-ai/dsh-credentials';
/** Stable id this provider registers under. */
export declare const ANYSEARCH_PROVIDER_ID = "anysearch";
/** Default AnySearch search endpoint base; `/v1/search` is the operation. */
export declare const ANYSEARCH_DEFAULT_BASE_URL = "https://api.anysearch.com";
/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface AnySearchSearchProviderOptions {
    /** Literal AnySearch API key; when present it wins over {@link resolveApiKey}. */
    apiKey?: string;
    /** Resolve the current AnySearch API key for one search operation. */
    resolveApiKey?: () => Promise<string | undefined>;
    /** Credential reference named by missing-credential diagnostics. */
    apiKeyEnv?: CredentialRef;
    /** Endpoint base; `/v1/search` is appended. */
    baseURL: string;
    /** Default result count when a request carries no `maxResults`. */
    maxResults?: number;
    /** Optional sub-domain capability tag, e.g. `code.doc`. */
    tag?: string;
    /** Optional region, one of `cn` or `intl`. */
    zone?: string;
    /** Optional preferred language, e.g. `zh-CN` or `en`. */
    language?: string;
}
/** One AnySearch result entry. */
export interface AnySearchResultItem {
    title?: string;
    url?: string;
    snippet?: string;
    /** Per-result body text; the richer of the three text fields. */
    content?: string;
    /** Short description, used as the snippet when `snippet` is absent. */
    description?: string;
    /** Publication/crawl timestamp, ISO-8601 when present. */
    published_at?: string;
}
/** The `data` envelope of a successful AnySearch response. */
export interface AnySearchResponseData {
    results?: AnySearchResultItem[];
    metadata?: {
        total_results?: number;
        search_time_ms?: number;
    };
}
/** The parsed AnySearch response body. */
export interface AnySearchResponse {
    /** Envelope status: `0`/absent means success; any other value is a business error even when HTTP is 200. */
    code?: number;
    /** Envelope error text, present when `code` is non-zero. */
    message?: string;
    request_id?: string;
    /** Nested payload envelope (`data.data.results` / `data.data.metadata`). */
    data?: AnySearchResponseData;
    /** Flat payload envelope (`data.results`) accepted for services that skip nesting. */
    results?: AnySearchResultItem[];
}
/**
 * Map an AnySearch response envelope to a normalized search result. Entries
 * without a URL are dropped; `title` and `snippet` are optional on the wire and
 * stay optional here. The web service owns the final `maxResults` truncation,
 * so this provider reports `truncated: false`.
 * @param response - the parsed `POST /v1/search` response body.
 * @returns the normalized result.
 */
export declare function mapAnySearchResponse(response: AnySearchResponse): WebSearchResult;
/** The AnySearch-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export declare class AnySearchSearchProvider implements WebSearchProvider {
    private readonly resolveOptions;
    readonly id = "anysearch";
    /**
     * @param resolveOptions - options for the NEXT operation, snapshotted once at
     * each operation's entry so one search never mixes two settings revisions.
     */
    constructor(resolveOptions: () => AnySearchSearchProviderOptions);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
    /**
     * Resolve one operation's credential without retaining it on the provider.
     * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
     * @param signal - abort signal for the surrounding search.
     * @returns the resolved key.
     */
    private apiKey;
}
