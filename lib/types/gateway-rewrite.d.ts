export declare const inject: string[];
/** 单条伪装规则：命中 host 的请求改写 UA；proxyUrl 非空时强制经该代理出网。 */
export interface RewriteRule {
    /** 目标域名，精确或 `*.example.com` 通配（含子域）。 */
    host: string;
    /** 覆盖后的 User-Agent；空串表示不改 UA（仅走代理）。 */
    userAgent: string;
    /** 可选 HTTP 代理地址（http://host:port）；留空直连。 */
    proxyUrl: string;
}
type PluginContext = any;
export declare function applyGatewayRewrite(ctx: PluginContext): void;
export {};
