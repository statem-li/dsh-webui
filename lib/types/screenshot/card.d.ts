import { type ShotTheme } from './theme.js';
/** 单条待渲染消息。 */
export interface ShotMessage {
    role: 'user' | 'assistant';
    text: string;
}
/** 卡片组装参数。 */
export interface ShotCardInput {
    messages: readonly ShotMessage[];
    theme: ShotTheme;
    /** 卡片宽度（CSS px）。 */
    width: number;
    /** 卡片最小高度（CSS px），短消息保底版面。 */
    minHeight: number;
    /** 卡片大标题；一般传会话标题，留空时从首条消息正文推导。 */
    title?: string;
    /** 页头徽章文案（如「这一轮问答」），留空按消息数与角色生成。 */
    label?: string;
}
/** 从消息文本提取标题：首个有意义内容行，剥离 Markdown 标记，截断到 64 字符。 */
export declare function deriveTitle(text: string, role: 'user' | 'assistant'): string;
/**
 * 组装完整截图 HTML 文档。
 * @param input - 消息、主题、尺寸与文案。
 * @returns 可直接写入临时 file:// 页面的 HTML 字符串。
 */
export declare function buildCardHtml(input: ShotCardInput): Promise<string>;
