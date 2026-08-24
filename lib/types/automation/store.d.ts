/**
 * automation — 定时任务存储（参考 openhanako CronStore：jobs.json + runs/<jobId>.jsonl）。
 *
 * 只负责持久化与游标推进，不做调度判断（调度在 scheduler.ts）：
 *  - 全部写入走「从磁盘重读 → 同步修改 → 原子写回」的 _mutate 流程，
 *    storeRevision 随每次落盘自增，跨实例写入天然互不覆盖；
 *  - 主文件损坏时自动从 .tmp 恢复并把损坏文件备份为 *.bak；
 *  - markRun：成功清零错误并按计划推进 nextRunAt，失败按退避表推迟，
 *    at 类型执行一次后自动停用；
 *  - 运行历史按任务一个 jsonl 文件追加，超过 500 行修剪到最后 300 行。
 */
import { type AddJobInput, type CronJob, type JobType, type RunRecord, type UpdateJobPatch } from './types.js';
/** 数据根：${DSH_HOME:-~/.dsh}/automation/dsh-webui/。 */
export declare function automationDataRoot(): string;
export declare class CronStore {
    readonly jobsPath: string;
    readonly runsDir: string;
    /** 完整产出目录根（runs/<jobId>/<stamp>.md，由 executor 写入）。 */
    readonly outputsDir: string;
    private jobs;
    private nextNum;
    private storeRevision;
    /** 重入防护：同一时刻只允许一个 mutator。 */
    private mutating;
    constructor(jobsPath?: string, runsDir?: string);
    /** 从磁盘读文档；主文件缺失/损坏时尝试用 .tmp 快照恢复。 */
    private readState;
    /** 用 .tmp 快照恢复：保留损坏主文件的备份后原地还原。 */
    private recoverFromTmp;
    private load;
    private adopt;
    /** 原子写：先写 .tmp 再 rename 覆盖。 */
    private writeState;
    /** 读-改-写事务：mutator 必须同步；changed=false 时不落盘不升版本。 */
    private mutate;
    /** 新建任务。at 必须指向未来；every 最小 1 分钟；缺省 label 取 prompt 前 30 字。 */
    addJob(input: AddJobInput): CronJob;
    /** 删除任务，并顺带清掉它的运行历史与完整产出目录（避免孤儿文件常驻）。 */
    removeJob(id: string): boolean;
    getJob(id: string): CronJob | null;
    listJobs(): CronJob[];
    /**
     * 更新任务字段（白名单）。改 type 必须同时给 schedule；任何影响执行的变更
     * 都会重算 nextRunAt 并自增 configRevision。
     */
    updateJob(id: string, patch: UpdateJobPatch): CronJob | null;
    /** 启用/停用切换；重新启用时从当前时刻重算下次触发。 */
    toggleJob(id: string): CronJob | null;
    /**
     * 标记一次运行结束：更新 lastRunAt 并推进 nextRunAt。
     * 成功 → 清零连续错误、按计划推进；失败 → 连续错误 +1、按退避表取较晚者；
     * at 类型执行一次后自动停用（一次性任务完成即退役）。
     * expectedConfigRevision 不匹配时拒绝写入（运行期间被编辑过）。
     */
    markRun(id: string, opts?: {
        success?: boolean;
        expectedConfigRevision?: number | null;
    }): boolean;
    /** 追加一条运行记录（jsonl）；超阈值时修剪旧行。 */
    logRun(jobId: string, run: Omit<RunRecord, 'timestamp'>): void;
    /** 清空某任务的运行历史与完整产出（保留任务本体）。 */
    clearRunHistory(id: string): void;
    /** 删除某任务的 jsonl 历史与 runs/<id>/ 产出目录（幂等、失败静默）。 */
    private purgeRunArtifacts;
    /** 读取某任务的运行记录（最新在后，最多 limit 条）。 */
    getRunHistory(jobId: string, limit?: number): RunRecord[];
    /** 计算下次执行时间；返回 ISO 字符串或 null（不再触发）。 */
    calcNextRun(type: JobType, schedule: string | number, fromIso: string): string | null;
    /**
     * 完整 5 字段 cron 解析：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6,7=周日)。
     * 支持「星号」「星号斜杠步进」「范围 N-M」「范围步进」与逗号列表；
     * 「日」「周」同时受限时按 OR 语义（标准 cron 行为）。
     * 从下一分钟起逐分钟搜索，上限 366 天。
     */
    private parseSimpleCron;
}
