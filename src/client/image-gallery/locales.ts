/** `gallery` namespace dictionaries（dsh-image-gallery 的界面文案）。 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'gig.head': '生图结果 · {n} 张',
  'gig.thumbTitle': '单击放大',
  'gig.hint': '点击空白处或按 Esc 关闭 · 右上角按钮可保存图片',
  'gig.broken': '图片链接已失效（生图链接仅 24 小时有效）',
  'gig.lightboxAria': '生图预览',
  'gig.close': '关闭预览',
  'gig.save': '保存图片',
  'gig.saving': '保存中…',
  'gig.saved': '已保存',
  'gig.saveFailed': '保存失败，请重试',
} satisfies Record<string, string>

/** The gallery namespace key union. */
export type GalleryKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'gig.head': 'Generated images · {n}',
  'gig.thumbTitle': 'Click to zoom',
  'gig.hint': 'Click background or press Esc to close · save via the top-right button',
  'gig.broken': 'Image link expired (generated links are valid for 24 hours)',
  'gig.lightboxAria': 'Generated image preview',
  'gig.close': 'Close preview',
  'gig.save': 'Save image',
  'gig.saving': 'Saving…',
  'gig.saved': 'Saved',
  'gig.saveFailed': 'Save failed, please retry',
} satisfies Record<GalleryKey, string>