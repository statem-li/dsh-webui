import type { Context } from 'cordis';
export declare const MAIL_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export declare const DEFAULT_AUTH_CODE_REF = "MAIL_IMAP_AUTH_CODE";
/** 邮箱验证码插件配置（全部可选）。 */
export interface MailConfig {
    /** 邮箱账号（如 2601259226@qq.com），存 settings。 */
    email?: string;
}
/** 注册 mail_get_code 工具 + /api/webui-mail 路由（webui 组合调用）。 */
export declare function applyMail(ctx: Context, config?: MailConfig): void;
