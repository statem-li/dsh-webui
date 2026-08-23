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
/** 一侧的一行：原始行号（1 起）与文本（不含行尾换行）。 */
export interface DiffSideLine {
    no: number;
    text: string;
}
/** 一条对齐行：kind 决定渲染着色与哪侧留空。 */
export interface DiffRow {
    kind: 'ctx' | 'add' | 'del' | 'mod';
    l?: DiffSideLine;
    r?: DiffSideLine;
}
export interface AlignResult {
    rows: DiffRow[];
    /** 右侧新增的行数。 */
    added: number;
    /** 左侧被删除的行数。 */
    removed: number;
    /** 上下文（未变）行数。 */
    unchanged: number;
    /** 任一侧超出单侧行数上限被截断。 */
    truncated: boolean;
}
/**
 * 计算两段文本的双栏对齐 diff。输入任意一段可为空串（整体视为新增/删除）。
 */
export declare function alignTextDiff(oldText: string, newText: string): AlignResult;
