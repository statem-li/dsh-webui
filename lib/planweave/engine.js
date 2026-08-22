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
import { initManagedWorkspace, claimNext, submitBlockResult, submitReviewResult, submitFeedback, getExecutionStatus, runDoctor, getPrompt, readProjectPaths, } from '@planweave-ai/runtime';
import { ensurePlanweaveHome } from './workspace.js';
export class PlanweaveEngine {
    root;
    projectId;
    constructor(root, projectId) {
        this.root = root;
        this.projectId = projectId;
    }
    /** 幂等打开（或首次创建）托管项目。 */
    static async open(name) {
        ensurePlanweaveHome();
        const trimmed = name.trim();
        if (trimmed === '')
            throw new Error('PlanWeave 项目名不能为空');
        const init = await initManagedWorkspace({ name: trimmed });
        return new PlanweaveEngine(init.workspace.rootPath, init.project.id);
    }
    /** 完整执行状态（任务/块/反馈/认领提示/计数）。 */
    status() {
        return getExecutionStatus({ projectRoot: this.root });
    }
    /** 认领下一个就绪项（block / feedback / batch / none / blocked）。 */
    claim() {
        return claimNext({ projectRoot: this.root });
    }
    /** 认领指定 block ref。 */
    claimRef(ref) {
        return claimNext({ projectRoot: this.root, scope: { kind: 'block', blockRef: ref } });
    }
    /** 提交实现块结果（reportPath 为已写好的 report.md 绝对路径）。 */
    submitResult(ref, reportPath) {
        return submitBlockResult({ projectRoot: this.root, ref, reportPath });
    }
    /** 提交评审结果（resultPath 为已写好的 review-result.json 绝对路径）。 */
    submitReview(ref, resultPath) {
        return submitReviewResult({ projectRoot: this.root, ref, resultPath });
    }
    /** 提交反馈修复报告。 */
    submitFeedback(reportPath) {
        return submitFeedback({ projectRoot: this.root, reportPath });
    }
    /** 状态/结果一致性自检与修复。 */
    doctor(repair = false) {
        return runDoctor({ projectRoot: this.root, repair });
    }
    /** 渲染指定 block/task ref 的完整 prompt（global→project→task→block 合并）。 */
    prompt(ref) {
        return getPrompt({ projectRoot: this.root, ref });
    }
    /** 磁盘路径快照（供诊断/调试）。 */
    paths() {
        return readProjectPaths(this.root);
    }
}
//# sourceMappingURL=engine.js.map