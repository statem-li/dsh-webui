/**
 * team — 持久化层（host 半身）。
 *
 * 数据根：${DSH_HOME:-~/.dsh}/team/
 *   ├── globals.json          TeamGlobals
 *   ├── teams/<teamId>.json   一团队一文件（用户可直接编辑 / 纳入 git / 导入导出）
 *   ├── chat-mode.json        sessionId → ChatModeState（最多 200 条，LRU 淘汰）
 *   └── runs/R-<ts>-<rand>/   run.json + steps/*.md + final-deliverable.md
 *
 * 写入一律「临时文件 + rename」原子替换；读取失败降级为「只读 + 报错提示」，
 * 单个坏文件不影响其它团队。
 */
import { type ChatModeState, type Run, type RunSummary, type Team, type TeamGlobals, type TeamSummary } from './types.js';
/** 数据根：${DSH_HOME:-~/.dsh}/team/。 */
export declare function teamDataRoot(): string;
/** 团队存储 + 运行存储。 */
export declare class TeamStore {
    readonly root: string;
    readonly teamsDir: string;
    readonly runsDir: string;
    readonly globalsPath: string;
    readonly chatModePath: string;
    constructor(root?: string);
    /** 首次运行（teams/ 为空）时播种出厂默认团队并设为 activeTeamId。 */
    private seedIfEmpty;
    /** 读全局默认（缺失/损坏回默认值）。 */
    readGlobals(): TeamGlobals;
    /** 写全局默认。 */
    writeGlobals(next: unknown): TeamGlobals;
    /** 合并式更新 globals。 */
    patchGlobals(patch: Record<string, unknown>): TeamGlobals;
    private teamPath;
    /** 团队 id 列表（按文件名）。 */
    listTeamIds(): string[];
    /** 读单个团队；不存在或损坏抛 TeamError。 */
    readTeam(id: string): Team;
    /** 读团队，失败返回 null（列表投影用）。 */
    tryReadTeam(id: string): {
        team: Team;
    } | {
        issue: string;
    };
    /** 团队清单（坏文件以 readonly + issue 呈现，不隐藏）。 */
    listTeams(): TeamSummary[];
    /** 保存团队（归一化 + 刷新 updatedAt + 原子写）。 */
    saveTeam(input: unknown): Team;
    /** 新建团队：seed=true 用出厂编制，否则空白团队（只含主脑 + 一条空链）。 */
    createTeam(name: string, options?: {
        seed?: boolean;
        id?: string;
    }): Team;
    /** 复制团队（深拷贝 roles/chains/links，新 id）。 */
    duplicateTeam(sourceId: string, name?: string): Team;
    /** 删除团队；删掉 activeTeamId 时自动切到剩余的第一个。 */
    removeTeam(id: string): {
        removed: string;
        activeTeamId: string;
    };
    /** 恢复某团队为出厂编制（保留 id 与名称，覆盖角色/链/直连）。 */
    resetTeam(id: string): Team;
    /** 由名称派生一个未被占用的团队 id。 */
    private allocTeamId;
    /** 解析「有效团队」：显式 id → activeTeamId → 第一个团队。 */
    resolveTeam(id?: string): Team;
    /** 读全部会话开关表。 */
    readChatModes(): Record<string, ChatModeState>;
    /** 读单会话开关（缺省=关闭）。 */
    readChatMode(sessionId: string): ChatModeState;
    /** 写单会话开关（LRU 淘汰到 CHAT_MODE_MAX 条）。 */
    writeChatMode(sessionId: string, patch: Partial<ChatModeState>): ChatModeState;
    /** 会话当前团队 id：会话级 teamId 优先，未选过时回退全局默认。 */
    sessionActiveTeamId(sessionId: string): string;
    /** 设置会话当前团队（仅写会话级，不动全局默认）。 */
    setSessionActiveTeam(sessionId: string, teamId: string): void;
    /** 按会话解析有效团队：会话当前团队 → 全局默认 → 第一个可用。 */
    resolveTeamForSession(id: string | undefined, sessionId: string): Team;
    /** 某次运行的目录。 */
    runDir(runId: string): string;
    /** 某次运行的 run.json 路径。 */
    runPath(runId: string): string;
    /** 分配一个运行 id。 */
    allocRunId(): string;
    /** 原子写 run.json（每步状态变化调用一次）。 */
    saveRun(run: Run): void;
    /** 读 run.json；不存在/损坏返回 null。 */
    readRun(runId: string): Run | null;
    /** 运行 id 列表（新→旧）。 */
    listRunIds(): string[];
    /** 运行清单（可按团队/会话过滤）。 */
    listRuns(options?: {
        teamId?: string;
        sessionId?: string;
        limit?: number;
    }): RunSummary[];
    /** 某会话的活跃运行（queued / running），新→旧。 */
    activeRuns(sessionId: string): Run[];
    /** 写单步完整输出，返回文件名。 */
    writeStepOutput(runId: string, index: number, roleId: string, content: string): string;
    /** 读单步完整输出。 */
    readStepOutput(runId: string, name: string): string;
    /** 写最终交付物，返回文件名。 */
    writeFinal(runId: string, content: string): string;
    /** 读最终交付物。 */
    readFinal(runId: string): string;
    /** 删除一次运行（含目录）。 */
    removeRun(runId: string): void;
    /** 修剪历史：保留最近 RUNS_KEEP 个运行目录。 */
    trimRuns(): void;
    /**
     * 启动时把上次进程遗留的「未完结」运行标记为 interrupted，
     * 避免 HUD 永远显示一个假的运行中。
     */
    markInterruptedOnBoot(): number;
}
/** Run → 清单项投影。 */
export declare function summarizeRun(run: Run): RunSummary;
