/**
 * 极简 IMAP-over-TLS 客户端（QQ 邮箱 imap.qq.com:993）。
 *
 * 只做 webui 邮件功能需要的两件事：登录/统计（test）与「拉最近 N 封邮件的
 * 头 + 正文 + 提取验证码」（summary）。协议解析是 literal 感知的：FETCH 响应
 * 里的 `{N}` 字面量按字节消费，不用按行切。
 */
import { connect } from 'node:tls';
export const DEFAULT_IMAP_HOST = 'imap.qq.com';
export const DEFAULT_IMAP_PORT = 993;
class ImapClient {
    sock;
    buf = Buffer.alloc(0);
    pos = 0;
    tagCounter = 0;
    waiters = [];
    error = null;
    constructor(sock) {
        this.sock = sock;
        sock.on('data', (chunk) => {
            this.buf = Buffer.concat([this.buf, chunk]);
            this.drain();
        });
        sock.on('error', (e) => {
            this.error = e;
            this.drain();
        });
    }
    request(command) {
        const tag = 'A' + (++this.tagCounter);
        this.sock.write(tag + ' ' + command + '\r\n');
        return new Promise((resolve, reject) => {
            this.waiters.push({ tag, resolve, reject, tagged: null, untagged: [] });
            this.drain();
        });
    }
    drain() {
        if (this.error !== null) {
            const e = this.error;
            for (const w of this.waiters.splice(0))
                w.reject(e);
            return;
        }
        for (;;) {
            const r = this.parseOne();
            if (r === null)
                return;
            const active = this.waiters[0];
            if (active === undefined)
                continue; // greeting / BYE between commands
            if (r.type === 'tagged') {
                const idx = this.waiters.findIndex((w) => w.tag === r.tag);
                if (idx >= 0) {
                    const w = this.waiters.splice(idx, 1)[0];
                    w.tagged = r;
                    w.resolve(w);
                }
            }
            else {
                active.untagged.push(r);
            }
        }
    }
    parseOne() {
        const buf = this.buf;
        let p = this.pos;
        while (p < buf.length && (buf[p] === 0x20 || buf[p] === 0x0d || buf[p] === 0x0a))
            p++;
        if (p >= buf.length) {
            this.pos = p;
            return null;
        }
        let type;
        let tag;
        const start = p;
        if (buf[p] === 0x2a) {
            type = 'untagged';
            p++;
        }
        else if (buf[p] === 0x2b) {
            type = 'continuation';
            p++;
        }
        else {
            type = 'tagged';
            const ts = p;
            while (p < buf.length && buf[p] !== 0x20 && buf[p] !== 0x0d)
                p++;
            tag = buf.slice(ts, p).toString('utf8');
        }
        const tokens = [];
        const r = this.parseTokens(p, tokens);
        if (r === null) {
            this.pos = start;
            return null;
        }
        this.pos = r.next;
        const text = buf.slice(start, r.lineEnd).toString('utf8');
        return { type, tag, tokens, text };
    }
    parseTokens(p, tokens) {
        const buf = this.buf;
        for (;;) {
            while (p < buf.length && buf[p] === 0x20)
                p++;
            if (p >= buf.length)
                return null;
            const c = buf[p];
            if (c === 0x0d) {
                if (buf.length < p + 2)
                    return null;
                return { next: p + 2, lineEnd: p };
            }
            if (c === 0x0a)
                return { next: p + 1, lineEnd: p };
            if (c === 0x28) {
                const list = [];
                const r = this.parseTokens(p + 1, list);
                if (r === null)
                    return null;
                tokens.push({ type: 'list', value: list });
                p = r.next;
                continue;
            }
            if (c === 0x29)
                return { next: p + 1, lineEnd: p };
            if (c === 0x22) {
                let q = p + 1;
                let out = '';
                let done = false;
                while (q < buf.length) {
                    const ch = buf[q];
                    if (ch === 0x5c) {
                        q++;
                        if (q < buf.length) {
                            out += String.fromCharCode(buf[q]);
                            q++;
                        }
                        continue;
                    }
                    if (ch === 0x22) {
                        done = true;
                        q++;
                        break;
                    }
                    out += String.fromCharCode(ch);
                    q++;
                }
                if (!done)
                    return null;
                tokens.push({ type: 'atom', value: out });
                p = q;
                continue;
            }
            if (c === 0x7b) {
                let q = p + 1;
                let num = '';
                while (q < buf.length && buf[q] >= 0x30 && buf[q] <= 0x39) {
                    num += String.fromCharCode(buf[q]);
                    q++;
                }
                if (q >= buf.length || buf[q] !== 0x7d)
                    return null;
                q++;
                if (buf.length < q + 2)
                    return null;
                if (buf[q] === 0x0d && buf[q + 1] === 0x0a)
                    q += 2;
                else if (buf[q] === 0x0a)
                    q += 1;
                else
                    return null;
                const n = Number.parseInt(num, 10);
                if (buf.length < q + n)
                    return null;
                tokens.push({ type: 'literal', value: buf.slice(q, q + n) });
                p = q + n;
                continue;
            }
            let a = p;
            while (a < buf.length && buf[a] !== 0x20 && buf[a] !== 0x0d && buf[a] !== 0x0a && buf[a] !== 0x28 && buf[a] !== 0x29)
                a++;
            tokens.push({ type: 'atom', value: buf.slice(p, a).toString('utf8') });
            p = a;
        }
    }
}
// ── 连接 ────────────────────────────────────────────────────────────────────
function connectImap(opts) {
    const host = opts.host ?? DEFAULT_IMAP_HOST;
    const port = opts.port ?? DEFAULT_IMAP_PORT;
    return new Promise((resolve, reject) => {
        const sock = connect(port, host, { servername: host });
        const client = new ImapClient(sock);
        sock.once('secureConnect', () => resolve({ sock, client }));
        sock.once('error', reject);
    });
}
function close(sock) {
    try {
        sock.end();
    }
    catch {
        /* ignore */
    }
}
// ── helpers ─────────────────────────────────────────────────────────────────
function flatten(tokens, out = []) {
    for (const t of tokens) {
        if (t.type === 'list')
            flatten(t.value, out);
        else
            out.push(t);
    }
    return out;
}
function headerField(headerText, name) {
    const re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':[ \\t]*([\\s\\S]*?)(?:\\r?\\n[^ \\t]|$)', 'im');
    const m = headerText.match(re);
    if (m === null)
        return '';
    return m[1].replace(/\r?\n[ \t]+/g, ' ').trim();
}
function decodeMimeWords(str) {
    return str.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _cs, enc, data) => {
        try {
            if (String(enc).toLowerCase() === 'b')
                return Buffer.from(String(data), 'base64').toString('utf8');
            return String(data).replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(Number.parseInt(String(h), 16)));
        }
        catch {
            return _m;
        }
    });
}
function decodeQuotedPrintable(s) {
    const bytes = [];
    const str = s.replace(/=\r?\n/g, '');
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '=' && i + 2 < str.length && /^[0-9A-Fa-f]{2}$/.test(str.slice(i + 1, i + 3))) {
            bytes.push(Number.parseInt(str.slice(i + 1, i + 3), 16));
            i += 2;
        }
        else {
            bytes.push(str.charCodeAt(i));
        }
    }
    return Buffer.from(bytes).toString('utf8');
}
function stripMime(s) {
    return s
        .replace(/^------=_Part[^\r\n]*$/gm, ' ')
        .replace(/^Content-[^\r\n:]+:[^\r\n]*$/gim, ' ')
        .replace(/^charset=[^\r\n]*$/gim, ' ')
        .replace(/=\?[^?]+\?[bBqQ]\?[^?]*\?=/g, '');
}
function stripHtml(s) {
    return s
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ');
}
function decodeBody(rawText, headerText) {
    let text = rawText;
    const cte = headerField(headerText, 'Content-Transfer-Encoding').toLowerCase();
    if (cte === 'quoted-printable')
        text = decodeQuotedPrintable(text);
    else if (cte === 'base64') {
        const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
        try {
            text = Buffer.from(clean, 'base64').toString('utf8');
        }
        catch { /* keep */ }
    }
    else if (/=\r?\n|=([0-9A-Fa-f]{2})/.test(text)) {
        text = decodeQuotedPrintable(text);
    }
    return text;
}
function extractCodes(text) {
    const codes = [];
    const seen = new Set();
    const add = (c) => { if (c !== '' && !seen.has(c)) {
        seen.add(c);
        codes.push(c);
    } };
    const hinted = /(?:验证码|校验码|验证|校验|动态码|授权码|安全码|一次性密码|verification\s*code|verify\s*code|security\s*code|one[-\s]?time\s*(?:passcode|code|password)|\botp\b|\bcode\b)[^\d]{0,24}(\d{4,8})/gi;
    let m;
    while ((m = hinted.exec(text)) !== null)
        add(m[1]);
    const re6 = /(?<!\d)(\d{6})(?!\d)/g;
    while ((m = re6.exec(text)) !== null)
        add(m[1]);
    return codes;
}
function extractMessage(flat) {
    let uid = null;
    let headerBuf = null;
    let textBuf = null;
    for (let i = 0; i < flat.length; i++) {
        const t = flat[i];
        if (t.type !== 'atom')
            continue;
        const v = t.value.toUpperCase();
        if (v === 'UID' && flat[i + 1]?.type === 'atom') {
            uid = flat[i + 1].value;
            i++;
            continue;
        }
        if (v.startsWith('BODY[') && flat[i + 1]?.type === 'literal') {
            const lit = flat[i + 1].value;
            if (v.includes('HEADER'))
                headerBuf = lit;
            else if (v.includes('TEXT'))
                textBuf = lit;
            else if (v === 'BODY[]')
                textBuf = lit;
            i++;
        }
    }
    return { uid, headerBuf, textBuf };
}
// ── 对外能力 ────────────────────────────────────────────────────────────────
/** 登录 + SELECT INBOX，返回统计（test 动作）。 */
export async function testImapLogin(opts) {
    const { sock, client } = await connectImap(opts);
    try {
        const login = await client.request('LOGIN "' + opts.user + '" "' + opts.pass + '"');
        if (login.tagged === null || !/OK/i.test(login.tagged.text)) {
            throw new Error('IMAP 登录失败: ' + (login.tagged?.text ?? 'no response'));
        }
        const sel = await client.request('SELECT INBOX');
        const ex = (sel.untagged.map((u) => u.text).find((t) => /EXISTS/i.test(t)) ?? '').match(/\*\s*(\d+)\s+EXISTS/i);
        const un = (sel.untagged.map((u) => u.text).find((t) => /UIDNEXT/i.test(t)) ?? '').match(/UIDNEXT\s+(\d+)/i);
        return {
            ok: true,
            exists: ex !== null ? Number.parseInt(ex[1], 10) : null,
            uidNext: un !== null ? Number.parseInt(un[1], 10) : null,
        };
    }
    finally {
        close(sock);
    }
}
/** 拉最近 `limit` 封邮件的头 + 正文 + 验证码。 */
export async function fetchRecentMails(opts, limit) {
    const { sock, client } = await connectImap(opts);
    try {
        const login = await client.request('LOGIN "' + opts.user + '" "' + opts.pass + '"');
        if (login.tagged === null || !/OK/i.test(login.tagged.text)) {
            throw new Error('IMAP 登录失败: ' + (login.tagged?.text ?? 'no response'));
        }
        const sel = await client.request('SELECT INBOX');
        const ex = (sel.untagged.map((u) => u.text).find((t) => /EXISTS/i.test(t)) ?? '').match(/\*\s*(\d+)\s+EXISTS/i);
        const exists = ex !== null ? Number.parseInt(ex[1], 10) : 0;
        const start = Math.max(1, exists - limit + 1);
        const range = exists >= 1 ? start + ':' + exists : '1:*';
        const uidResp = await client.request('FETCH ' + range + ' (UID)');
        const uids = [];
        for (const u of uidResp.untagged) {
            const m = u.text.match(/FETCH.*\bUID\s+(\d+)/i);
            if (m !== null)
                uids.push(Number.parseInt(m[1], 10));
        }
        uids.sort((a, b) => a - b);
        const messages = [];
        for (const uid of uids.slice(-limit)) {
            const r = await client.request('UID FETCH ' + uid + ' (UID BODY.PEEK[HEADER] BODY.PEEK[TEXT])');
            for (const u of r.untagged) {
                const fe = extractMessage(flatten(u.tokens));
                if (fe.headerBuf === null && fe.textBuf === null)
                    continue;
                const headerText = fe.headerBuf !== null ? fe.headerBuf.toString('utf8') : '';
                const from = decodeMimeWords(headerField(headerText, 'From'));
                const subject = decodeMimeWords(headerField(headerText, 'Subject'));
                const date = decodeMimeWords(headerField(headerText, 'Date'));
                const rawText = fe.textBuf !== null ? fe.textBuf.toString('utf8') : '';
                const text = stripHtml(decodeMimeWords(stripMime(decodeBody(rawText, headerText)))).trim();
                messages.push({
                    uid: fe.uid,
                    from,
                    subject,
                    date,
                    text: text.slice(0, 20000),
                    codes: extractCodes(subject + ' ' + text),
                });
            }
        }
        return messages;
    }
    finally {
        close(sock);
    }
}
//# sourceMappingURL=imap.js.map