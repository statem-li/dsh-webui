import type { Context } from 'cordis';
import z from '@deepseek-ai/schemastery';
type PluginContext = Context & Record<string, any>;
export declare const name = "@dsh-external/dsh-browser";
export declare const inject: string[];
export interface Config {
    /** Chrome/Edge 可执行文件路径（空 = 自动探测常见路径） */
    chromePath: string;
    /** CDP 起始端口（0 = 自动从 9222 起找空闲端口；每会话独立端口） */
    port: number;
    /** 截图输出目录（空 = Chrome profile 目录下 screenshots/） */
    screenshotDir: string;
}
export declare const Config: z<Schemastery.ObjectS<{
    chromePath: z<string, string>;
    port: z<number, number>;
    screenshotDir: z<string, string>;
}>, Schemastery.ObjectT<{
    chromePath: z<string, string>;
    port: z<number, number>;
    screenshotDir: z<string, string>;
}>>;
export declare function applyBrowser(ctx: PluginContext, config: Config): void;
export {};
