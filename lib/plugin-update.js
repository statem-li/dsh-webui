/**
 * webui — 插件自更新（host 半身，模块 key：pluginUpdate）。
 *
 * 面向「别人装了这个插件」的场景：设置页一个按钮即可检测 GitHub 上是否有
 * 新版本，并直接在当前 profile 里就地更新，无需用户手敲 pnpm / dsh plugin。
 *
 * 检测（不需要本地 git、不需要任何凭据，纯匿名 HTTPS GET）：
 *  - 远端版本：raw.githubusercontent.com/<repo>/<branch>/package.json 的 version；
 *  - 远端提交：<repo>.git/info/refs?service=git-upload-pack 里 refs/heads/<branch>
 *    的 sha（git 智能 HTTP 协议的 ref 广告，匿名可读、不吃 GitHub API 限流）。
 *
 * 更新（按安装形态分流，自动判定）：
 *  - pnpm 托管（`dsh plugin --profile web add github:statem-li/dsh-webui`，
 *    普通用户的形态）：在 profile 目录里重跑一次 `pnpm add <原始 spec>`——
 *    git spec 会重新解析分支 ref 到最新提交，等价于「重装最新」；registry
 *    形态则走 `pnpm update <name> --latest`。仓库里带编译产物 lib/，装完
 *    即可用，无需在用户机器上构建。
 *  - 本地 checkout（spec 为 link:/file:，或包目录本身是 git 仓库，即开发者
 *    自己的形态）：`git pull --ff-only`。
 *
 * 更新落盘后需**重启 DSH** 才生效（插件在加载时一次性装配），本模块只做
 * 更新与状态上报，不代用户重启（跨平台不可靠）。
 *
 * HTTP API：
 *   GET  /api/webui-plugin-update            → 全量状态
 *   POST /api/webui-plugin-update/check      → 拉取远端版本/提交
 *   POST /api/webui-plugin-update/apply      → 执行更新（body 可传 {"force":true} 强制重装）
 *
 * settings 命名空间 `webui-plugin-update`：autoCheck / repo / branch。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { applyFilePatch, blobSha, isInstalledPath, parseTreeApi, splitPatches, } from './plugin-update-patch.js';
/** 包根目录（lib/ 的上一级）。 */
const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const STATE_DIR = join(DSH_HOME, 'webui-plugin-update');
const RESULT_FILE = join(STATE_DIR, 'last-result.json');
/** settings 命名空间与 API 前缀。 */
export const PLUGIN_UPDATE_NAMESPACE = 'webui-plugin-update';
export const PLUGIN_UPDATE_API = '/api/webui-plugin-update';
/** 默认上游仓库（fork 用户可在设置里改）。 */
const DEFAULT_REPO = 'statem-li/dsh-webui';
const DEFAULT_BRANCH = 'main';
/** 命令行参数白名单：spec 来自本地 package.json，仍做一次形状校验再进 spawn。 */
const SAFE_SPEC_RE = /^[A-Za-z0-9@._:/+#~^><=-]+$/;
/** owner/repo 形状。 */
const SAFE_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** 分支名（够宽松，但排除空格与 shell 元字符）。 */
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const FETCH_TIMEOUT_MS = 20000;
/** 补丁/文件树下载超时：体积可达一两 MB，给足时间。 */
const PATCH_TIMEOUT_MS = 120000;
const MAX_LOG_LINES = 80;
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 65536) {
                req.destroy();
                resolve(null);
            }
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(data || '{}'));
            }
            catch {
                resolve(null);
            }
        });
        req.on('error', () => resolve(null));
    });
}
/**
 * 跑一条命令，收集输出。参数始终以数组传入交给 execFile 语义（不拼字符串、
 * 不开 shell），避免任何注入面。
 */
function run(bin, args, cwd, timeoutMs) {
    return new Promise((resolve) => {
        let out = '';
        let done = false;
        const child = spawn(bin, [...args], {
            cwd,
            env: process.env,
            windowsHide: true,
        });
        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                try {
                    child.kill();
                }
                catch { /* 已退出 */ }
                resolve({ ok: false, code: 'timeout', out: out + '\n[超时]' });
            }
        }, timeoutMs);
        // Windows 控制台工具（cmd.exe 自身的报错等）按系统 ANSI 代码页输出，
        // 按 UTF-8 解会变成乱码进日志；中文 Windows 上先按 GBK 解，失败再退回
        // UTF-8（pnpm/git 自身输出是 UTF-8，ASCII 部分两种解码一致）。
        const decode = (chunk) => {
            const buffer = chunk;
            const utf8 = buffer.toString('utf8');
            if (!utf8.includes('\uFFFD'))
                return utf8;
            try {
                return new TextDecoder('gbk').decode(buffer);
            }
            catch {
                return utf8;
            }
        };
        child.stdout?.on('data', (chunk) => { out += decode(chunk); });
        child.stderr?.on('data', (chunk) => { out += decode(chunk); });
        child.on('error', (error) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve({ ok: false, code: error?.code ?? 'error', out: out + '\n' + String(error?.message ?? error) });
        });
        child.on('close', (code) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve({ ok: code === 0, code: code ?? 'null', out });
        });
    });
}
/**
 * 归一化依赖 spec：pnpm 有时把 git spec 里的分支 fragment 落成解析后的提交
 * sha（`github:owner/repo#a117b74…`），照原样重装等于「装回同一个旧提交」。
 * 纯 hex fragment 一律剥掉，让 git spec 重新解析默认分支的最新提交；
 * `#semver:` / `#branch-name` 这类有意义的 fragment 原样保留。
 */
export function normalizeSpec(spec) {
    const at = spec.lastIndexOf('#');
    if (at === -1)
        return spec;
    const fragment = spec.slice(at + 1);
    return /^[0-9a-f]{7,40}$/.test(fragment) ? spec.slice(0, at) : spec;
}
/**
 * 跑一条「命令行工具」：Windows 上 pnpm / dsh 都是 .cmd shim，spawn 直接执行
 * 会被 Node 拒绝（CVE-2024-27980 加固），经 cmd.exe 本体转发；参数仍以数组
 * 传递（execFile 语义，Node 负责转义），不开 shell、不拼字符串。
 */
function runTool(bin, args, cwd, timeoutMs) {
    if (process.platform !== 'win32')
        return run(bin, args, cwd, timeoutMs);
    const comspec = process.env.ComSpec || 'cmd.exe';
    return run(comspec, ['/d', '/s', '/c', bin, ...args], cwd, timeoutMs);
}
/** 语义化版本比较：a 比 b 新返回 1，旧返回 -1，相同返回 0（预发布后缀忽略）。 */
export function compareVersions(a, b) {
    const parse = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => Number(n) || 0);
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const x = left[i] ?? 0;
        const y = right[i] ?? 0;
        if (x !== y)
            return x > y ? 1 : -1;
    }
    return 0;
}
/** 带超时的 GET（文本）。 */
async function getText(url, accept = '*/*', timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'cache-control': 'no-cache', 'user-agent': 'dsh-webui-plugin-update', accept },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return await res.text();
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 依次尝试多个 URL，返回第一个成功的响应体；全失败时抛出汇总错误。
 * 同一份资源在 GitHub 上常有多个可达域名，而不同网络下可达性差别很大。
 */
async function getFirst(candidates, label, timeoutMs = PATCH_TIMEOUT_MS) {
    const errors = [];
    for (const candidate of candidates) {
        try {
            return await getText(candidate.url, candidate.accept ?? '*/*', timeoutMs);
        }
        catch (error) {
            errors.push(`${new URL(candidate.url).host}: ${String(error?.message ?? error)}`);
        }
    }
    throw new Error(`${label}下载失败（${errors.join('；')}）`);
}
/**
 * 从 git 智能 HTTP 的 ref 广告里取某分支的 sha。响应是 pkt-line 流，每行
 * 前 4 字节是十六进制长度，行内容形如 `<sha> refs/heads/main`。
 */
export function parseRefSha(advertisement, branch) {
    const needle = `refs/heads/${branch}`;
    for (const raw of advertisement.split('\n')) {
        if (!raw.includes(needle))
            continue;
        const m = /([0-9a-f]{40})\s+refs\/heads\//.exec(raw);
        if (m)
            return m[1];
    }
    return null;
}
/** 读本地包信息（version 来自随包发布的 package.json）。 */
function readLocal() {
    const manifest = readJson(join(PKG_DIR, 'package.json')) ?? {};
    return {
        name: typeof manifest.name === 'string' ? manifest.name : '@dsh-external/dsh-webui',
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        commit: null,
        dir: PKG_DIR,
    };
}
/** 本地是否 git 仓库（开发者 checkout 形态）。 */
function isGitCheckout(dir) {
    return existsSync(join(dir, '.git'));
}
/**
 * 从 profile 的 pnpm-lock.yaml 里取本包已安装的提交 sha。
 *
 * 为什么需要：git 形态安装的版本号来自仓库 package.json，作者不一定每次提交
 * 都 bump version——只比版本号会漏掉「同版本号但有新提交」的更新。pnpm 把
 * 解析结果记进锁文件，两种写法都可能出现：
 *   version: https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>
 *   version: git+https://github.com/<owner>/<repo>.git#<sha>
 * 逐行扫描（不引 YAML 解析器），命中包名后取随后几行里第一个 40 位 sha。
 */
export function parseLockCommit(lock, packageName) {
    const lines = lock.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes(packageName))
            continue;
        for (let j = i; j < Math.min(i + 4, lines.length); j += 1) {
            const m = /(?:tar\.gz\/|#|commit:\s*)([0-9a-f]{40})/.exec(lines[j]);
            if (m)
                return m[1];
        }
    }
    return null;
}
/** 读 profile 锁文件里本包的已安装提交（pnpm 形态精确比较用）。 */
function readLockCommit(profileDir, packageName) {
    try {
        return parseLockCommit(readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8'), packageName);
    }
    catch {
        return null;
    }
}
/**
 * 增量更新写在包目录里的「当前提交」标记文件。
 *
 * 增量打补丁不经过 pnpm，锁文件仍停在旧 sha，只靠锁文件判断会永远显示「有
 * 更新」。标记放在包目录内而非 DSH_HOME：一旦用户/pnpm 重装本包，整个目录被
 * 重建、标记随之消失，判定自动回落到锁文件——两条信息不会互相说谎。
 */
const COMMIT_MARKER = '.dsh-update-commit';
/** 写增量更新标记（打完补丁后调用；写不进去只影响下次判定精度，不算失败）。 */
function writeMarkerCommit(pkgDir, commit) {
    try {
        writeFileSync(join(pkgDir, COMMIT_MARKER), commit + '\n', 'utf8');
    }
    catch { /* 只读安装目录等场景：忽略 */ }
}
/** 读包目录里的增量更新标记（优先于锁文件）。 */
function readMarkerCommit(pkgDir) {
    try {
        const raw = readFileSync(join(pkgDir, COMMIT_MARKER), 'utf8').trim();
        return /^[0-9a-f]{40}$/.test(raw) ? raw : null;
    }
    catch {
        return null;
    }
}
/**
 * 已安装提交：包目录标记优先，其次 profile 锁文件。
 * @param pkgDir - 已安装的包目录。
 * @param profileDir - profile 目录（可能为 null）。
 * @param packageName - 本包名。
 */
function readInstalledCommit(pkgDir, profileDir, packageName) {
    return readMarkerCommit(pkgDir) ?? (profileDir === null ? null : readLockCommit(profileDir, packageName));
}
/**
 * 判定安装形态与更新执行目录。
 *
 * pnpm 形态下包躺在 `<profile>/node_modules/...`，逐级上溯即可找到声明了
 * `dsh.profile` 的 profile 目录；link/file 形态包在别处，回退到扫描
 * `$DSH_HOME/profiles/*` 找出把本包列为依赖的那个 profile（拿它的 spec）。
 */
function detectInstall(local) {
    // 1) 上溯找 profile（pnpm 形态）
    let dir = PKG_DIR;
    for (let depth = 0; depth < 8; depth += 1) {
        const manifest = readJson(join(dir, 'package.json'));
        if (manifest?.dsh?.profile !== undefined) {
            const spec = manifest.dependencies?.[local.name] ?? null;
            return classify(dir, spec, local);
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    // 2) 扫描 profiles 目录（link/file 形态，或包被提到别处）
    const profilesDir = join(DSH_HOME, 'profiles');
    let names = [];
    try {
        names = readdirSync(profilesDir).filter(n => n !== 'node_modules');
    }
    catch { /* 无 profiles 目录 */ }
    for (const name of names) {
        const profileDir = join(profilesDir, name);
        const manifest = readJson(join(profileDir, 'package.json'));
        const spec = manifest?.dependencies?.[local.name];
        if (typeof spec === 'string')
            return classify(profileDir, spec, local);
    }
    return {
        kind: isGitCheckout(local.dir) ? 'checkout' : 'unknown',
        profileDir: null,
        spec: null,
        reason: isGitCheckout(local.dir)
            ? null
            : '未能定位安装本插件的 profile 目录，无法自动更新；请手动执行 dsh plugin --profile web add github:' + DEFAULT_REPO,
    };
}
/** 由 spec 与包目录形态判定 kind。 */
function classify(profileDir, spec, local) {
    const linked = typeof spec === 'string' && /^(link|file):/.test(spec);
    if (linked || isGitCheckout(local.dir)) {
        return { kind: 'checkout', profileDir, spec, reason: null };
    }
    if (typeof spec !== 'string') {
        return {
            kind: 'unknown',
            profileDir,
            spec: null,
            reason: `profile ${profileDir} 的依赖里没有 ${local.name}，无法确定更新来源`,
        };
    }
    return { kind: 'pnpm', profileDir, spec, reason: null };
}
function writeResult(result) {
    try {
        mkdirSync(STATE_DIR, { recursive: true });
        writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
    }
    catch { /* 状态落盘失败不影响更新 */ }
}
// ── 增量更新（只下改动，不重装整包）──────────────────────────────────────
/**
 * 安全替换安装目录里的一个文件。
 *
 * pnpm 用**硬链接**把全局 store 里的文件挂进 node_modules（实测 nlink=6，
 * 同一份 blob 被多个项目共享）。直接以写模式打开原文件会顺着硬链接改写
 * store 内容，污染机器上所有引用该 blob 的项目。正确做法：写同目录临时文件
 * → 删除原文件（断开链接）→ rename 顶替，写入只落在这一份副本上。
 */
function replaceFile(path, content) {
    const tmp = path + '.dsh-update-tmp';
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, content);
    try {
        if (existsSync(path))
            rmSync(path, { force: true });
        renameSync(tmp, path);
    }
    catch (error) {
        rmSync(tmp, { force: true });
        throw error;
    }
}
/**
 * 按 unified diff 算出增量更新计划，并用目标提交的 blob sha 逐文件校验。
 *
 * 任何一个文件对不上（二进制补丁、上下文漂移、本地被手改过）都直接抛错，
 * 由调用方回退整包重装——绝不把半成品写进安装目录。
 *
 * @param pkgDir - 已安装的包目录。
 * @param diff - 两个提交之间的 unified diff。
 * @param targetTree - 目标提交的「路径 → blob sha」表。
 * @param files - package.json 的 files 声明（判定哪些路径真的被安装）。
 */
export function planIncremental(pkgDir, diff, targetTree, files) {
    const plan = { writes: [], deletes: [], skipped: 0 };
    for (const patch of splitPatches(diff)) {
        const path = patch.to ?? patch.from;
        if (path === null)
            continue;
        if (!isInstalledPath(path, files)) {
            plan.skipped += 1;
            continue;
        }
        if (patch.binary)
            throw new Error(`${path}: 二进制补丁，增量更新不支持`);
        const abs = join(pkgDir, path);
        if (patch.deleted) {
            plan.deletes.push(abs);
            continue;
        }
        const original = patch.added || !existsSync(abs) ? null : readFileSync(abs, 'utf8');
        const result = applyFilePatch(original, patch);
        if (result === null)
            throw new Error(`${path}: 补丁上下文不匹配（本地文件可能被改动过）`);
        const content = Buffer.from(result, 'utf8');
        const want = targetTree.get(path);
        if (want === undefined)
            throw new Error(`${path}: 目标提交里没有该文件的校验值`);
        if (blobSha(content) !== want)
            throw new Error(`${path}: 打完补丁校验不符（期望 ${want.slice(0, 8)}）`);
        plan.writes.push({ path: abs, content });
    }
    if (plan.writes.length === 0 && plan.deletes.length === 0) {
        throw new Error('增量补丁没有涉及任何已安装文件');
    }
    return plan;
}
/**
 * 装配插件自更新：settings 持久化 + 状态/检查/更新三个 HTTP 端点。
 * @param ctx - host 上下文。
 */
export function applyPluginUpdate(ctx) {
    let scope;
    try {
        scope = ctx.settings.register(PLUGIN_UPDATE_NAMESPACE, z.object({
            autoCheck: z.boolean().default(true),
            repo: z.string().default(DEFAULT_REPO),
            branch: z.string().default(DEFAULT_BRANCH),
        }));
    }
    catch (error) {
        console.log('[plugin-update] settings namespace already registered:', error?.message ?? error);
    }
    const readConfig = () => {
        let raw = {};
        if (scope !== undefined) {
            try {
                raw = scope.get() ?? {};
            }
            catch {
                raw = {};
            }
        }
        const repo = typeof raw.repo === 'string' && SAFE_REPO_RE.test(raw.repo) ? raw.repo : DEFAULT_REPO;
        const branch = typeof raw.branch === 'string' && SAFE_BRANCH_RE.test(raw.branch) ? raw.branch : DEFAULT_BRANCH;
        return { autoCheck: raw.autoCheck !== false, repo, branch };
    };
    const local = readLocal();
    const install = detectInstall(local);
    if (install.kind === 'checkout') {
        // 开发者 checkout：本地 HEAD 参与比较（比版本号精确）。
        void run('git', ['rev-parse', 'HEAD'], local.dir, 15000).then((r) => {
            if (r.ok)
                local.commit = r.out.trim().slice(0, 40);
        });
    }
    else {
        // pnpm 形态：已安装提交（增量标记优先，回落锁文件）参与比较——作者没
        // bump version 的提交也能发现。
        local.commit = readInstalledCommit(local.dir, install.profileDir, local.name);
    }
    const state = { busy: null, remote: null, error: null, log: [], stage: null, mode: null };
    const log = (line) => {
        state.log.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
        if (state.log.length > MAX_LOG_LINES)
            state.log.splice(0, state.log.length - MAX_LOG_LINES);
    };
    /**
     * 有更新？两端提交都已知时比提交（最精确，覆盖「同版本号新提交」）；否则
     * 退化为比版本号。都拿不到时视为无更新，用户仍可「强制重装最新」。
     */
    const hasUpdate = () => {
        const remote = state.remote;
        if (remote === null)
            return false;
        if (local.commit !== null && remote.commit !== null)
            return remote.commit !== local.commit;
        if (remote.version === null)
            return false;
        return compareVersions(remote.version, local.version) > 0;
    };
    async function check() {
        if (state.busy !== null)
            return { ok: false, message: '已有任务在进行中' };
        state.busy = 'checking';
        state.error = null;
        const { repo, branch } = readConfig();
        try {
            let version = null;
            let commit = null;
            // 同一份资源多个可达域名逐个回退：实测部分网络下 raw.githubusercontent
            // 与 github.com 会连接超时，而 api.github.com 秒回（反之也可能发生）。
            try {
                const text = await getFirst([
                    { url: `https://api.github.com/repos/${repo}/contents/package.json?ref=${branch}`, accept: 'application/vnd.github.raw' },
                    { url: `https://raw.githubusercontent.com/${repo}/${branch}/package.json?ts=${Date.now()}` },
                    { url: `https://github.com/${repo}/raw/${branch}/package.json?ts=${Date.now()}` },
                ], '远端 package.json', FETCH_TIMEOUT_MS);
                const manifest = JSON.parse(text);
                if (typeof manifest.version === 'string')
                    version = manifest.version;
            }
            catch (error) {
                log(String(error?.message ?? error));
            }
            try {
                // 远端提交：git 智能 HTTP 的 ref 广告（匿名可读、不吃 API 限流），
                // 不可达时退 refs API。
                const refs = await getText(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`);
                commit = parseRefSha(refs, branch);
            }
            catch (error) {
                log(`读取远端 ref 失败（git 协议）: ${String(error?.message ?? error)}`);
            }
            if (commit === null) {
                try {
                    const json = JSON.parse(await getText(`https://api.github.com/repos/${repo}/commits/${branch}`, 'application/vnd.github+json'));
                    if (typeof json.sha === 'string' && /^[0-9a-f]{40}$/.test(json.sha))
                        commit = json.sha;
                }
                catch (error) {
                    log(`读取远端 ref 失败（API）: ${String(error?.message ?? error)}`);
                }
            }
            if (version === null && commit === null) {
                state.error = `无法访问上游仓库 ${repo}（网络不可达或仓库不存在）`;
                return { ok: false, message: state.error };
            }
            state.remote = { version, commit, checkedAt: new Date().toISOString() };
            log(`检查完成：远端 version=${version ?? '未知'} commit=${commit?.slice(0, 7) ?? '未知'}`);
            return { ok: true };
        }
        catch (error) {
            state.error = String(error?.message ?? error);
            return { ok: false, message: state.error };
        }
        finally {
            state.busy = null;
        }
    }
    /**
     * 增量更新（默认路径）：只下载「两个提交之间的补丁」，就地打到已安装的包
     * 目录上，不重装整包。
     *
     * 三步：
     *  1. GET `compare/<old>...<new>.diff` 拿 unified diff（gzip 后通常几百 KB，
     *     整包 tarball 是 ~4.7 MB）；
     *  2. GET trees API 拿目标提交每个文件的 blob sha 作为校验基准；
     *  3. 逐文件打补丁 + 校验，**全部通过后**才统一落盘（硬链接安全替换）。
     *
     * 任何一步失败都抛错，由调用方回退整包重装。
     */
    async function updateIncremental(fromCommit, toCommit) {
        const { repo } = readConfig();
        state.stage = 'incremental';
        log(`增量更新 ${fromCommit.slice(0, 7)} → ${toCommit.slice(0, 7)}`);
        // 补丁源：api.github.com 的 diff 媒体类型最稳（实测 github.com/....diff
        // 在部分网络下持续连接失败，而 api 域名秒回），失败再退 github.com。
        const diff = await getFirst([
            { url: `https://api.github.com/repos/${repo}/compare/${fromCommit}...${toCommit}`, accept: 'application/vnd.github.diff' },
            { url: `https://github.com/${repo}/compare/${fromCommit}...${toCommit}.diff` },
        ], '增量补丁');
        log(`补丁下载完成：${Math.round(Buffer.byteLength(diff) / 1024)} KB（整包重装约 4.7 MB）`);
        const treeJson = JSON.parse(await getText(`https://api.github.com/repos/${repo}/git/trees/${toCommit}?recursive=1`, 'application/vnd.github+json'));
        const targetTree = parseTreeApi(treeJson);
        if (treeJson.truncated === true)
            throw new Error('目标提交文件树过大被截断，无法校验');
        if (targetTree.size === 0)
            throw new Error('未能取得目标提交的文件校验表');
        const manifest = readJson(join(local.dir, 'package.json')) ?? {};
        const files = Array.isArray(manifest.files) ? manifest.files : [];
        const plan = planIncremental(local.dir, diff, targetTree, files);
        log(`校验通过：${plan.writes.length} 个文件待更新、${plan.deletes.length} 个待删除（跳过 ${plan.skipped} 个未安装路径）`);
        // 校验全过后才落盘，降低中途失败留下半成品的窗口
        for (const item of plan.writes)
            replaceFile(item.path, item.content);
        for (const path of plan.deletes)
            rmSync(path, { force: true });
        writeMarkerCommit(local.dir, toCommit);
        local.commit = toCommit;
        log(`增量更新完成：已写入 ${plan.writes.length} 个文件`);
    }
    /**
     * pnpm 形态：在 profile 目录重装/升级本包。
     *
     * 优先走官方 `dsh plugin --profile <name> add <spec>`——它在 pnpm 之后还会
     * reconcile `dsh.profile.bundles` 层列表（纯 pnpm 不会）。`dsh` 不在 PATH
     * 上（打包壳子启动等场景）时回退到 profile 目录里直接跑 pnpm。
     */
    async function updateViaPnpm(rawSpec, profileDir) {
        const spec = normalizeSpec(rawSpec);
        if (!SAFE_SPEC_RE.test(spec)) {
            throw new Error(`依赖 spec 形状异常，已中止：${spec}`);
        }
        const gitLike = /^(github:|git\+|git:)/.test(spec) || /\.git(#.*)?$/.test(spec);
        const profileName = basename(profileDir);
        state.stage = 'pnpm';
        // 1) 官方 CLI（带 bundles 层 reconcile）
        const viaDsh = gitLike
            ? ['plugin', '--profile', profileName, 'add', spec]
            : ['plugin', '--profile', profileName, 'update', local.name, '--latest'];
        log(`dsh ${viaDsh.join(' ')}`);
        const dshRun = await runTool('dsh', viaDsh, profileDir, 900000);
        log(dshRun.out.trim().slice(-4000) || '(无输出)');
        if (dshRun.ok)
            return;
        log(`dsh CLI 不可用或失败（exit=${dshRun.code}），回退直接 pnpm`);
        // 2) 回退：profile 目录里直接 pnpm
        const args = gitLike ? ['add', spec] : ['update', local.name, '--latest'];
        log(`pnpm ${args.join(' ')}（cwd=${profileDir}）`);
        const r = await runTool('pnpm', args, profileDir, 900000);
        log(r.out.trim().slice(-4000) || '(无输出)');
        if (!r.ok) {
            throw new Error(`更新失败（pnpm exit=${r.code}）——若提示找不到 pnpm，请先安装 pnpm，或手动执行：dsh plugin --profile ${profileName} add ${spec}`);
        }
    }
    /** checkout 形态：git pull --ff-only。 */
    async function updateViaGit() {
        state.stage = 'git';
        log(`git pull --ff-only（cwd=${local.dir}）`);
        const r = await run('git', ['pull', '--ff-only'], local.dir, 600000);
        log(r.out.trim().slice(-4000) || '(无输出)');
        if (!r.ok) {
            throw new Error(`git pull 失败（exit=${r.code}）：本地可能有未提交改动或已分叉，请手动处理后重试`);
        }
        const head = await run('git', ['rev-parse', 'HEAD'], local.dir, 15000);
        if (head.ok)
            local.commit = head.out.trim().slice(0, 40);
    }
    /**
     * 启动更新。
     *
     * 策略（`mode` 决定，默认自动）：
     *  - checkout 形态 → `git pull --ff-only`（git 本身就是增量）；
     *  - pnpm 形态且两端提交已知 → **增量补丁**（只下改动，~几百 KB）；
     *    补丁失败（本地文件被改过 / 二进制改动 / 跨越太多提交）自动回退整包重装；
     *  - 其余（提交未知、用户点「强制重装」）→ 整包重装。
     *
     * @param force - 强制整包重装（跳过增量与「已是最新」判定）。
     */
    function startUpdate(force) {
        if (state.busy !== null)
            return { ok: false, message: '已有任务在进行中' };
        if (install.reason !== null)
            return { ok: false, message: install.reason };
        if (state.remote === null)
            return { ok: false, message: '请先点「检查更新」' };
        if (!hasUpdate() && !force)
            return { ok: false, message: '已是最新版本（如需强制重装，请使用「强制重装最新」）' };
        state.busy = 'updating';
        state.error = null;
        state.log = [];
        state.mode = null;
        const from = local.commit !== null ? local.commit.slice(0, 7) : local.version;
        const fromCommit = local.commit;
        const toCommit = state.remote.commit;
        void (async () => {
            try {
                if (install.kind === 'checkout') {
                    await updateViaGit();
                }
                else if (!force && fromCommit !== null && toCommit !== null) {
                    // 增量优先；失败则回退整包（原因写进日志，用户能看到为什么回退）
                    try {
                        state.mode = 'incremental';
                        await updateIncremental(fromCommit, toCommit);
                    }
                    catch (error) {
                        log(`增量更新失败，回退整包重装：${String(error?.message ?? error)}`);
                        state.mode = 'full';
                        if (install.spec === null || install.profileDir === null)
                            throw error;
                        await updateViaPnpm(install.spec, install.profileDir);
                    }
                }
                else if (install.kind === 'pnpm' && install.spec !== null && install.profileDir !== null) {
                    state.mode = 'full';
                    await updateViaPnpm(install.spec, install.profileDir);
                }
                else {
                    throw new Error(install.reason ?? '无法确定更新方式');
                }
                state.stage = 'done';
                if (install.kind !== 'checkout') {
                    // 重装后锁文件已指向新提交，刷新本地提交，徽章立刻回到「已是最新」。
                    local.commit = readInstalledCommit(local.dir, install.profileDir, local.name);
                }
                const to = local.commit?.slice(0, 7) ?? state.remote?.version ?? null;
                writeResult({ ok: true, at: new Date().toISOString(), from, to, kind: install.kind, mode: state.mode });
                log('更新完成，重启 DSH 后生效');
            }
            catch (error) {
                const message = String(error?.message ?? error);
                state.error = message;
                state.stage = 'error';
                writeResult({ ok: false, at: new Date().toISOString(), from, to: null, kind: install.kind, mode: state.mode, error: message });
                log(`更新失败：${message}`);
            }
            finally {
                state.busy = null;
            }
        })();
        return { ok: true, message: '更新已启动' };
    }
    const snapshot = () => ({
        ok: true,
        busy: state.busy,
        stage: state.stage,
        mode: state.mode,
        error: state.error,
        log: state.log.join('\n') || null,
        local: { name: local.name, version: local.version, commit: local.commit, dir: local.dir },
        remote: state.remote,
        install: { kind: install.kind, profileDir: install.profileDir, spec: install.spec, reason: install.reason },
        hasUpdate: hasUpdate(),
        config: readConfig(),
        lastResult: readJson(RESULT_FILE),
    });
    const handlers = {
        [PLUGIN_UPDATE_API]: async (req) => {
            if (req.method === 'POST') {
                const body = await readBody(req);
                if (body !== null && scope !== undefined && typeof body.autoCheck === 'boolean') {
                    await scope.update({ autoCheck: body.autoCheck });
                }
            }
            return snapshot();
        },
        [`${PLUGIN_UPDATE_API}/check`]: async (req) => {
            if (req.method !== 'POST')
                return null;
            const result = await check();
            return { ...snapshot(), ...result };
        },
        [`${PLUGIN_UPDATE_API}/apply`]: async (req) => {
            if (req.method !== 'POST')
                return null;
            const body = await readBody(req);
            const result = startUpdate(body?.force === true);
            return { ...snapshot(), ...result };
        },
    };
    for (const [path, fn] of Object.entries(handlers)) {
        ctx.effect(() => ctx.webServer.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
                try {
                    const body = await fn(req);
                    if (body === null) {
                        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }));
                        return;
                    }
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(body));
                }
                catch (error) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ ok: false, message: String(error?.message ?? error) }));
                }
            },
        }), `webui: plugin-update ${path}`);
    }
    // 启动后延迟一次静默检查（只更新状态，不改任何文件）；关掉 autoCheck 则不发请求。
    ctx.effect(() => {
        const timer = setTimeout(() => {
            if (readConfig().autoCheck)
                void check();
        }, 15000);
        return () => { clearTimeout(timer); };
    }, 'webui: plugin-update auto check');
    console.log(`[plugin-update] mounted kind=${install.kind} version=${local.version} profile=${install.profileDir ?? '(none)'}`);
}
//# sourceMappingURL=plugin-update.js.map