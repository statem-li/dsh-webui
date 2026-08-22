/**
 * webui — 内置示例计划包（播种用）。
 *
 * 与 PlanWeave 上游 examples/basic-plan-package 同构的六任务图（并行分支 +
 * 依赖汇合 + 一个必选评审门），prompt 为精简中文。用于「一键播种示例」：
 * 新项目零门槛看到 claim→执行→评审→反馈的完整闭环与任务图分层布局。
 */
/** 单个虚拟文件的文本内容。 */
export interface SeedFile {
    path: string;
    content: string;
}
/** 示例包 manifest（plan-package/v1）。 */
export declare const EXAMPLE_MANIFEST: Record<string, unknown>;
/** manifest 引用的全部 prompt markdown（相对 packageDir）。 */
export declare const EXAMPLE_PROMPT_FILES: SeedFile[];
