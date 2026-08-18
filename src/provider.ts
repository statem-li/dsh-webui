/**
 * `AnySearchSearchProvider`: a `WebSearchProvider` backed by the AnySearch
 * unified search API (`POST /v1/search`). It maps each result's
 * `title`/`url`/`snippet` into the normalized source shape and omits `content`
 * because AnySearch returns per-result body content, not a generated answer.
 * @module dsh-web-search-anysearch/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Stable id this provider registers under. */
export const ANYSEARCH_PROVIDER_ID = 'anysearch'

/** Default AnySearch search endpoint base; `/v1/search` is the operation. */
export const ANYSEARCH_DEFAULT_BASE_URL = 'https://api.anysearch.com'

/** Attribution header sent on every request. */
const USER_AGENT = 'dsh-web-search-anysearch/0.1.0'

/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface AnySearchSearchProviderOptions {
  /** Literal AnySearch API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current AnySearch API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/v1/search` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  maxResults?: number
  /** Optional sub-domain capability tag, e.g. `code.doc`. */
  tag?: string
  /** Optional region, one of `cn` or `intl`. */
  zone?: string
  /** Optional preferred language, e.g. `zh-CN` or `en`. */
  language?: string
}

/** One AnySearch result entry. */
export interface AnySearchResultItem {
  title?: string
  url?: string
  snippet?: string
  /** Per-result body text; the richer of the three text fields. */
  content?: string
  /** Short description, used as the snippet when `snippet` is absent. */
  description?: string
  /** Publication/crawl timestamp, ISO-8601 when present. */
  published_at?: string
}

/** The `data` envelope of a successful AnySearch response. */
export interface AnySearchResponseData {
  results?: AnySearchResultItem[]
  metadata?: {
    total_results?: number
    search_time_ms?: number
  }
}

/** The parsed AnySearch response body. */
export interface AnySearchResponse {
  /** Envelope status: `0`/absent means success; any other value is a business error even when HTTP is 200. */
  code?: number
  /** Envelope error text, present when `code` is non-zero. */
  message?: string
  request_id?: string
  /** Nested payload envelope (`data.data.results` / `data.data.metadata`). */
  data?: AnySearchResponseData
  /** Flat payload envelope (`data.results`) accepted for services that skip nesting. */
  results?: AnySearchResultItem[]
}

/**
 * Map an AnySearch response envelope to a normalized search result. Entries
 * without a URL are dropped; `title` and `snippet` are optional on the wire and
 * stay optional here. The web service owns the final `maxResults` truncation,
 * so this provider reports `truncated: false`.
 * @param response - the parsed `POST /v1/search` response body.
 * @returns the normalized result.
 */
export function mapAnySearchResponse(response: AnySearchResponse): WebSearchResult {
  // A non-zero envelope `code` is a business error even when HTTP is 200:
  // swallowing it would surface an empty result set as a successful search.
  if (response.code !== undefined && response.code !== 0) {
    const message = response.message?.trim()
    throw new WebError(
      `AnySearch API ${message !== undefined && message.length > 0 ? message : `code ${response.code}`}`,
      'WEB_PROVIDER_ERROR',
    )
  }
  const sources: WebSearchSource[] = []
  const results = response.data?.results ?? response.results ?? []
  for (const result of results) {
    const url = result.url
    if (url === undefined || url.length === 0) continue
    const snippet = result.snippet ?? result.description
    sources.push({
      url,
      ...result.title !== undefined && result.title.length > 0 ? { title: result.title } : {},
      ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
      ...result.published_at !== undefined && result.published_at.length > 0
        ? { publishedAt: result.published_at }
        : {},
    })
  }
  // AnySearch returns per-result body content, not a generated answer, so
  // `content` is omitted; the web seam truncates by `maxResults`.
  return { sources, truncated: false }
}

/** The AnySearch-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class AnySearchSearchProvider implements WebSearchProvider {
  readonly id = ANYSEARCH_PROVIDER_ID

  /**
   * @param resolveOptions - options for the NEXT operation, snapshotted once at
   * each operation's entry so one search never mixes two settings revisions.
   */
  constructor(private readonly resolveOptions: () => AnySearchSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    // The AnySearch free tier accepts requests without an API key, so a key is
    // not part of usability: a valid endpoint and result bound are enough.
    return URL.canParse(options.baseURL)
      && (options.maxResults === undefined || isPositiveInteger(options.maxResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const maxResults = request.maxResults ?? options.maxResults
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/v1/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
          ...apiKey !== undefined && apiKey.length > 0 ? { 'authorization': `Bearer ${apiKey}` } : {},
        },
        body: JSON.stringify({
          query: request.query,
          ...maxResults !== undefined ? { max_results: maxResults } : {},
          ...options.tag !== undefined && options.tag.length > 0 ? { tag: options.tag } : {},
          ...options.zone !== undefined && options.zone.length > 0 ? { zone: options.zone } : {},
          ...options.language !== undefined && options.language.length > 0 ? { language: options.language } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`AnySearch search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `AnySearch API error (HTTP ${status})`
      try {
        const parsed = await response.json() as Partial<AnySearchResponse>
        const detail = parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body can only cost a richer message.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as AnySearchResponse
      return mapAnySearchResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`AnySearch returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: AnySearchSearchProviderOptions, signal?: AbortSignal): Promise<string | undefined> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `AnySearch search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    // No literal or ambient key: fall through and serve without `Authorization`,
    // which AnySearch accepts as its anonymous free tier.
    return resolved !== undefined && resolved.length > 0 ? resolved : undefined
  }
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('AnySearch search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a request limit that can be sent to AnySearch (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
