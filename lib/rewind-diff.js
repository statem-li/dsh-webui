/**
 * webui — 行级双向对齐 diff（LCS）。
 *
 * 输出「左右并排」的对齐行序列：ctx 两栏各一行、mod 左右成对（内容不同）、
 * del 只有左栏、add 只有右栏。供文件浏览器「修改历史对比」视图直接渲染——
 * 两侧行数完全一致，共用一个滚动容器即天然同步滚动。
 *
 * 算法：trim 公共前缀/后缀 → 中间段 LCS 动态规划（单元格数有预算上限，
 * 超限退化为按行号顺序两两配对）→ 回溯出 op 序列 → 相邻 del-run 与 add-run
 * 配成 mod 行对。
 */
/** 单侧最多参与的行数；超出部分截断（truncated 标记）。 */
const MAX_SIDE_LINES = 5000;
/** LCS DP 单元格预算 (n+1)*(m+1)；超过则退化为顺序配对，避免内存/耗时爆炸。 */
const MAX_DP_CELLS = 6_000_000;
/** 按行切分：容忍 CRLF，丢弃结尾换行产生的空尾行。 */
function splitLines(text) {
    if (text === '')
        return [];
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '')
        lines.pop();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.endsWith('\r'))
            lines[i] = line.slice(0, -1);
    }
    return lines;
}
/**
 * 计算两段文本的双栏对齐 diff。输入任意一段可为空串（整体视为新增/删除）。
 */
export function alignTextDiff(oldText, newText) {
    let oldLines = splitLines(oldText);
    let newLines = splitLines(newText);
    let truncated = false;
    if (oldLines.length > MAX_SIDE_LINES) {
        oldLines = oldLines.slice(0, MAX_SIDE_LINES);
        truncated = true;
    }
    if (newLines.length > MAX_SIDE_LINES) {
        newLines = newLines.slice(0, MAX_SIDE_LINES);
        truncated = true;
    }
    const rows = [];
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    const pushCtx = (oi, ni) => {
        rows.push({
            kind: 'ctx',
            l: { no: oi + 1, text: oldLines[oi] },
            r: { no: ni + 1, text: newLines[ni] },
        });
        unchanged += 1;
    };
    const pushMod = (oi, ni) => {
        rows.push({
            kind: 'mod',
            l: { no: oi + 1, text: oldLines[oi] },
            r: { no: ni + 1, text: newLines[ni] },
        });
        removed += 1;
        added += 1;
    };
    const pushDel = (oi) => {
        rows.push({ kind: 'del', l: { no: oi + 1, text: oldLines[oi] } });
        removed += 1;
    };
    const pushAdd = (ni) => {
        rows.push({ kind: 'add', r: { no: ni + 1, text: newLines[ni] } });
        added += 1;
    };
    // 公共前缀 / 后缀（不重叠）：绝大多数编辑只动中间一小段，trim 后 DP 规模骤减。
    const minLen = Math.min(oldLines.length, newLines.length);
    let prefix = 0;
    while (prefix < minLen && oldLines[prefix] === newLines[prefix])
        prefix += 1;
    let suffix = 0;
    while (suffix < minLen - prefix
        && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix])
        suffix += 1;
    for (let i = 0; i < prefix; i++)
        pushCtx(i, i);
    const oldStart = prefix;
    const newStart = prefix;
    const oldEnd = oldLines.length - suffix;
    const newEnd = newLines.length - suffix;
    const n = oldEnd - oldStart;
    const m = newEnd - newStart;
    const ops = [];
    if (n > 0 && m > 0 && (n + 1) * (m + 1) <= MAX_DP_CELLS) {
        const width = m + 1;
        const dp = new Int32Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--) {
            const oi = oldStart + i;
            for (let j = m - 1; j >= 0; j--) {
                dp[i * width + j] = oldLines[oi] === newLines[newStart + j]
                    ? dp[(i + 1) * width + j + 1] + 1
                    : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (oldLines[oldStart + i] === newLines[newStart + j]) {
                ops.push({ k: 'ctx', oi: i, ni: j });
                i += 1;
                j += 1;
            }
            else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
                ops.push({ k: 'del', oi: i });
                i += 1;
            }
            else {
                ops.push({ k: 'add', ni: j });
                j += 1;
            }
        }
        while (i < n) {
            ops.push({ k: 'del', oi: i });
            i += 1;
        }
        while (j < m) {
            ops.push({ k: 'add', ni: j });
            j += 1;
        }
    }
    else if (n > 0 || m > 0) {
        // 超预算降级：按行号顺序两两配成 mod，剩余一侧单独成块。
        const paired = Math.min(n, m);
        for (let k = 0; k < paired; k++)
            ops.push({ k: 'pair', oi: k, ni: k });
        for (let k = paired; k < n; k++)
            ops.push({ k: 'del', oi: k });
        for (let k = paired; k < m; k++)
            ops.push({ k: 'add', ni: k });
    }
    // 组装：相邻 del-run × add-run 按 index 配成 mod 行对。
    let idx = 0;
    while (idx < ops.length) {
        const op = ops[idx];
        if (op.k === 'ctx') {
            pushCtx(oldStart + op.oi, newStart + op.ni);
            idx += 1;
            continue;
        }
        if (op.k === 'pair') {
            pushMod(oldStart + op.oi, newStart + op.ni);
            idx += 1;
            continue;
        }
        const dels = [];
        while (idx < ops.length && ops[idx].k === 'del') {
            dels.push(ops[idx].oi);
            idx += 1;
        }
        const adds = [];
        while (idx < ops.length && ops[idx].k === 'add') {
            adds.push(ops[idx].ni);
            idx += 1;
        }
        const pairs = Math.min(dels.length, adds.length);
        for (let p = 0; p < pairs; p++)
            pushMod(oldStart + dels[p], newStart + adds[p]);
        for (let p = pairs; p < dels.length; p++)
            pushDel(oldStart + dels[p]);
        for (let p = pairs; p < adds.length; p++)
            pushAdd(newStart + adds[p]);
    }
    for (let s = 0; s < suffix; s++)
        pushCtx(oldEnd + s, newEnd + s);
    return { rows, added, removed, unchanged, truncated };
}
//# sourceMappingURL=rewind-diff.js.map