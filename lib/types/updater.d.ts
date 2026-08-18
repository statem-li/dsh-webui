export declare const inject: string[];
export interface UpdaterConfig {
    /** DSH 源码仓库目录（默认 = 服务 cwd，即 deepseek-harness）。 */
    dshDir?: string;
    /** 壳子目录（找 dist\*.exe；默认 D:\AI\Dsh）。 */
    shellDir?: string;
    /** git 可执行文件（默认 git）。 */
    gitPath?: string;
}
export declare function applyUpdater(ctx: any, config?: UpdaterConfig): void;
