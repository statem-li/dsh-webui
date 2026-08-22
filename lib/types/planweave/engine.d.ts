/**
 * webui — PlanWeave 引擎（host 半身）。
 *
 * 把 `@planweave-ai/runtime` 的公开 API 封装成以「项目名」为入口的薄引擎：
 * - `PlanweaveEngine.open(name)`：幂等打开托管项目
 * - status / claim / submitResult / submitReview / submitFeedback / doctor / prompt
 *
 * 本层只做「参数整理 + 结果透传」，不重写任何图/状态机/幂等逻辑——那些全部
 * 复用 runtime。projectRoot 统一用 workspace.rootPath（托管项目的磁盘根）。
 */
import { claimNext, getExecutionStatus } from '@planweave-ai/runtime';
/** runtime 主入口未导出这些类型，用 ReturnType 派生。 */
type ExecutionStatus = Awaited<ReturnType<typeof getExecutionStatus>>;
type ClaimResult = Awaited<ReturnType<typeof claimNext>>;
/** 任务图视图（供 UI 渲染）：节点内嵌块状态与依赖，客户端无需再拼 manifest。 */
export interface GraphBlockView {
    ref: string;
    id: string;
    type: 'implementation' | 'review';
    title: string;
    status: string;
}
export interface GraphTaskView {
    taskId: string;
    title: string;
    status: string;
    dependsOn: string[];
    /** 任务验收标准（manifest task 节点的 acceptance）。 */
    acceptance: string[];
    /** 任务 prompt 文件路径（相对 packageDir 的 markdown 路径）。 */
    promptPath: string;
    /** manifest 配置的任务级 executor（未配置为 null）。 */
    executor: string | null;
    blocks: GraphBlockView[];
}
export interface PlanGraphView {
    projectTitle: string;
    nodes: GraphTaskView[];
}
export declare class PlanweaveEngine {
    readonly root: string;
    readonly projectId: string;
    private constructor();
    /** 幂等打开（或首次创建）托管项目。 */
    static open(name: string): Promise<PlanweaveEngine>;
    /** 完整执行状态（任务/块/反馈/认领提示/计数）。 */
    status(): Promise<ExecutionStatus>;
    /** 认领下一个就绪项（block / feedback / batch / none / blocked）。 */
    claim(): Promise<ClaimResult>;
    /** 认领指定 block ref。 */
    claimRef(ref: string): Promise<ClaimResult>;
    /** 提交实现块结果（reportPath 为已写好的 report.md 绝对路径）。 */
    submitResult(ref: string, reportPath: string): Promise<import("@planweave-ai/runtime").SubmitResult>;
    /** 提交评审结果（resultPath 为已写好的 review-result.json 绝对路径）。 */
    submitReview(ref: string, resultPath: string): Promise<import("@planweave-ai/runtime").SubmitReviewResult>;
    /** 提交反馈修复报告。 */
    submitFeedback(reportPath: string): Promise<import("@planweave-ai/runtime").SubmitFeedbackResult>;
    /** 状态/结果一致性自检与修复。 */
    doctor(repair?: boolean): Promise<import("@planweave-ai/runtime").DoctorReport>;
    /** 渲染指定 block/task ref 的完整 prompt（global→project→task→block 合并）。 */
    prompt(ref: string): Promise<string>;
    /** 磁盘路径快照（供诊断/调试）。 */
    paths(): Promise<import("@planweave-ai/runtime").ProjectPathsResult>;
    /**
     * 任务图视图：manifest（节点/依赖）× 运行状态合并。图结构来自
     * `loadPackage` + `compileTaskGraph`（runtime 纯函数），状态来自 status()。
     */
    graph(): Promise<PlanGraphView>;
}
export {};
