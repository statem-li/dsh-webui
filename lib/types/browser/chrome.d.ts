/**
 * Chrome 进程管理：启动独立实例（固定 user-data-dir、自动端口探测）。
 */
import { type ChildProcess } from 'node:child_process';
export declare const DEFAULT_CHROME_CANDIDATES: string[];
export declare function resolveChromePath(candidates: string[]): string;
/** 探测空闲端口（从 base 开始） */
export declare function findFreePort(base?: number, maxTries?: number): Promise<number>;
export declare function isPortFree(port: number): Promise<boolean>;
export interface ChromeRuntime {
    proc: ChildProcess;
    port: number;
    profileDir: string;
}
/**
 * 启动 Chrome。幂等由调用方保证（port/profile 检查）。
 * @param chromePath Chrome 可执行文件路径
 * @param profileDir 独立用户数据目录（cookies/登录态持久化）
 * @param port CDP 端口（调用方先 findFreePort）
 * @param headless 无头模式
 * @param args 附加参数
 */
export declare function launchChrome(chromePath: string, profileDir: string, port: number, headless?: boolean, args?: string[]): ChromeRuntime;
export declare function killChrome(runtime: ChromeRuntime | null, force?: boolean): void;
/** 根据 session 标识生成 profile 目录名 */
export declare function profileDirFor(rootDir: string, key: string): string;
