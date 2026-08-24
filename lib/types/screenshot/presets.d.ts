/**
 * webui — 截图尺寸预设（host / client 两端共用的纯数据）。
 *
 * 「设备 × 画质」两档选择，映射成一组 CSS 宽度 + 输出缩放：
 *  - 电脑版：横幅版面（宽屏阅读，适合发群/贴文档）；
 *  - 手机版：窄幅版面（竖屏阅读，转发到聊天里不用横向缩放）。
 *  - 1080P / 2K / 4K 决定的是**输出像素宽度**，靠 deviceScaleFactor 放大，
 *    文字始终按 CSS 宽度排版，所以放大画质不会让版式变形、只会更清晰。
 *
 * 高度不固定：内容多就自动往下长（长图），这里给的是最小高度。
 */
/** 设备版式。 */
export type ShotDevice = 'desktop' | 'phone';
/** 输出画质档。 */
export type ShotQuality = '1080p' | '2k' | '4k';
/**
 * 画幅比例：'auto' = 跟随内容长度（现状长图行为）；其余为固定宽高比，
 * 内容不足时补背景画布、超出时保留完整内容（比例退化为下限）。
 */
export type ShotAspect = 'auto' | '16:9' | '4:3' | '1:1' | '9:16' | '3:4';
/** 画幅中文名。 */
export declare const ASPECT_LABEL: Record<ShotAspect, string>;
/** 画幅档位顺序（UI 分段选择按此渲染）。 */
export declare const SHOT_ASPECTS: readonly ShotAspect[];
/**
 * 解析画幅参数。
 * @returns 固定比例的宽高比数值；自适应 / 未知值返回 null。
 */
export declare function shotAspectRatio(aspect: unknown): number | null;
/** 一档预设的渲染参数。 */
export interface ShotPreset {
    /** 排版用的 CSS 宽度（决定字号/留白比例）。 */
    cssWidth: number;
    /** 输出缩放（deviceScaleFactor）。 */
    scale: number;
    /** 卡片最小高度（CSS px），内容更高时自动扩展。 */
    minHeight: number;
}
/** 设备 × 画质 → 渲染参数。 */
export declare const SHOT_PRESETS: Record<ShotDevice, Record<ShotQuality, ShotPreset>>;
/** 设备档中文名。 */
export declare const DEVICE_LABEL: Record<ShotDevice, string>;
/** 画质档中文名。 */
export declare const QUALITY_LABEL: Record<ShotQuality, string>;
/**
 * 取一档预设（未知值回退电脑版 2K）。
 * @param device - 设备版式。
 * @param quality - 画质档。
 * @returns 该档的渲染参数。
 */
export declare function shotPreset(device: unknown, quality: unknown): ShotPreset & {
    device: ShotDevice;
    quality: ShotQuality;
};
