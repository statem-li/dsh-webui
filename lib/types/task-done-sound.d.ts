export declare const inject: string[];
export interface TaskDoneSoundConfig {
    /** wav 兜底目录（默认 D:\AI\Dsh\assets）。 */
    soundDir?: string;
    /** 壳子目录（找 dist\*.exe 做卡片标题/点击目标；默认 D:\AI\Dsh）。 */
    shellDir?: string;
    /** false 时禁用卡片（仅保留 /dyn-assets 音频服务）。 */
    cardEnabled?: boolean;
}
export declare function applyTaskDoneSound(ctx: any, config?: TaskDoneSoundConfig): void;
