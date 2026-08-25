/**
 * 配置渲染引擎的工作目录。
 * @param baseDir - 返回工作目录绝对路径的函数（profile 与临时 HTML 落在这里）。
 */
export declare function configureRenderer(baseDir: () => string): void;
/** 关闭常驻实例（幂等；空闲回收与插件卸载共用）。 */
export declare function shutdownRenderer(): Promise<void>;
/** 渲染参数。 */
export interface RenderInput {
    html: string;
    /** 布局视口宽度（CSS px）。 */
    width: number;
    /** 起始视口高度（CSS px），内容更高时自动扩展成长图。 */
    height: number;
    /** 输出缩放（deviceScaleFactor；缺省 2x）。 */
    scale?: number;
    /** 正文含 mermaid 围栏：投放引擎文件并等图画完再截。 */
    needsMermaid?: boolean;
}
/**
 * 渲染 HTML 为 PNG（base64）。串行执行；实例失效时自动重建并重试一次。
 * @param input - HTML 与视口尺寸。
 * @returns PNG 的 base64 数据（不含 data: 前缀）。
 */
export declare function renderPng(input: RenderInput): Promise<string>;
