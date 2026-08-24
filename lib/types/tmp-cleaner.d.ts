/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** AI 临时产物的约定目录名（工作区根直接子级）。 */
export declare const TMP_DIR_NAME = "_tmp";
export interface CleanerConfig {
    /** 自动调度总开关（手动 API / agent 工具不受它限制）。 */
    enabled: boolean;
    /** 调度类型：daily=每天固定时刻；interval=固定间隔小时。 */
    scheduleKind: 'daily' | 'interval';
    /** daily 模式的触发时刻，HH:mm（默认 03:30）。 */
    dailyTime: string;
    /** interval 模式的间隔小时数（默认 12）。 */
    intervalHours: number;
    /** 文件最小年龄（小时）：mtime 距今不足该时长的一律不动。 */
    minAgeHours: number;
    /** 服务启动后是否补跑一轮（延迟 15s 避开启动高峰）。 */
    cleanOnStart: boolean;
    /** 是否注入「临时脚本写 _tmp/」系统提示词约定。 */
    injectPrompt: boolean;
    /** 追加的自定义文件规则（* ? 通配，匹配 basename）。 */
    extraPatterns: string[];
    /** 是否顺带清理扫描中发现的完全空目录（默认关）。 */
    cleanEmptyDirs: boolean;
}
/**
 * 托管置顶记忆的识别 tag：tmpCleaner 按 tag 幂等维护这条记忆（存在性 +
 * pinned 状态），**不覆盖内容**——用户在记忆面板改过文案后重启不会被打回；
 * 想恢复默认文案删掉这条记忆再重启 DSH 即可重建。
 */
export declare const CONVENTION_TAG = "tmp-cleaner-convention";
interface CleanItem {
    path: string;
    bytes: number;
    /** 命中原因：'_tmp 目录' / 规则文本 / '空目录'。 */
    reason: string;
}
export interface CleanResult {
    startedAt: string;
    dryRun: boolean;
    workspaces: string[];
    items: CleanItem[];
    freedBytes: number;
    errors: string[];
    truncated: boolean;
}
/**
 * 装配 tmpCleaner host 能力。
 * @param ctx - host 上下文。
 */
export declare function applyTmpCleaner(ctx: PluginContext): Promise<void>;
export {};
