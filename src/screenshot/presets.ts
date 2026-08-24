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
export type ShotDevice = 'desktop' | 'phone'

/** 输出画质档。 */
export type ShotQuality = '1080p' | '2k' | '4k'

/**
 * 画幅比例：'auto' = 跟随内容长度（现状长图行为）；其余为固定宽高比，
 * 内容不足时补背景画布、超出时保留完整内容（比例退化为下限）。
 */
export type ShotAspect = 'auto' | '16:9' | '4:3' | '1:1' | '9:16' | '3:4'

/** 画幅 → 宽高比数值（auto 无固定比）。 */
const ASPECT_RATIO: Record<Exclude<ShotAspect, 'auto'>, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
}

/** 画幅中文名。 */
export const ASPECT_LABEL: Record<ShotAspect, string> = {
  auto: '自适应',
  '16:9': '16:9',
  '4:3': '4:3',
  '1:1': '1:1',
  '9:16': '9:16',
  '3:4': '3:4',
}

/** 画幅档位顺序（UI 分段选择按此渲染）。 */
export const SHOT_ASPECTS: readonly ShotAspect[] = ['auto', '16:9', '4:3', '1:1', '9:16', '3:4']

/**
 * 解析画幅参数。
 * @returns 固定比例的宽高比数值；自适应 / 未知值返回 null。
 */
export function shotAspectRatio(aspect: unknown): number | null {
  if (typeof aspect !== 'string') return null
  const ratio = (ASPECT_RATIO as Record<string, number | undefined>)[aspect]
  return typeof ratio === 'number' ? ratio : null
}

/** 一档预设的渲染参数。 */
export interface ShotPreset {
  /** 排版用的 CSS 宽度（决定字号/留白比例）。 */
  cssWidth: number
  /** 输出缩放（deviceScaleFactor）。 */
  scale: number
  /** 卡片最小高度（CSS px），内容更高时自动扩展。 */
  minHeight: number
}

/** 设备 × 画质 → 渲染参数。 */
export const SHOT_PRESETS: Record<ShotDevice, Record<ShotQuality, ShotPreset>> = {
  desktop: {
    // 960×2 = 1920 宽
    '1080p': { cssWidth: 960, scale: 2, minHeight: 540 },
    // 1280×2 = 2560 宽
    '2k': { cssWidth: 1280, scale: 2, minHeight: 720 },
    // 1280×3 = 3840 宽
    '4k': { cssWidth: 1280, scale: 3, minHeight: 720 },
  },
  phone: {
    // 540×2 = 1080 宽
    '1080p': { cssWidth: 540, scale: 2, minHeight: 900 },
    // 480×3 = 1440 宽
    '2k': { cssWidth: 480, scale: 3, minHeight: 820 },
    // 540×4 = 2160 宽
    '4k': { cssWidth: 540, scale: 4, minHeight: 900 },
  },
}

/** 设备档中文名。 */
export const DEVICE_LABEL: Record<ShotDevice, string> = {
  desktop: '电脑版',
  phone: '手机版',
}

/** 画质档中文名。 */
export const QUALITY_LABEL: Record<ShotQuality, string> = {
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
}

/**
 * 取一档预设（未知值回退电脑版 2K）。
 * @param device - 设备版式。
 * @param quality - 画质档。
 * @returns 该档的渲染参数。
 */
export function shotPreset(device: unknown, quality: unknown): ShotPreset & { device: ShotDevice; quality: ShotQuality } {
  const d: ShotDevice = device === 'phone' ? 'phone' : 'desktop'
  const q: ShotQuality = quality === '1080p' || quality === '4k' ? quality : '2k'
  return { ...SHOT_PRESETS[d][q], device: d, quality: q }
}
