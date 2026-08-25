export declare const inject: string[];
/** 单条限流规则：命中 host 的请求先过 RPM 令牌桶，再过并发信号量。 */
export interface ThrottleRule {
    /** 目标域名，精确或 `*.example.com` 通配（含子域）。 */
    host: string;
    /** 每分钟最多请求数（1..6000，默认 20）。 */
    maxRpm: number;
    /** 同时进行的请求数上限（1..16，默认 2）。 */
    maxConcurrency: number;
}
type PluginContext = any;
export declare function applyProviderThrottle(ctx: PluginContext): void;
export {};
