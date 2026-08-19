export declare const DEFAULT_IMAP_HOST = "imap.qq.com";
export declare const DEFAULT_IMAP_PORT = 993;
export interface ImapOptions {
    host?: string;
    port?: number;
    user: string;
    pass: string;
}
export type MailMessage = {
    uid: string | null;
    from: string;
    subject: string;
    date: string;
    text: string;
    codes: string[];
};
export interface ImapStats {
    ok: boolean;
    exists: number | null;
    uidNext: number | null;
}
/** 登录 + SELECT INBOX，返回统计（test 动作）。 */
export declare function testImapLogin(opts: ImapOptions): Promise<ImapStats>;
/** 拉最近 `limit` 封邮件的头 + 正文 + 验证码。 */
export declare function fetchRecentMails(opts: ImapOptions, limit: number): Promise<MailMessage[]>;
