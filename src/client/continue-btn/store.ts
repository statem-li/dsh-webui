/**
 * webui — 一键继续配置存取（localStorage；client 端即时生效，无需 host）。
 *
 * - text：「继续文字」，默认「继续」。发送时写入草稿并提交。
 * - hide：「不在对话中显示」开关（默认开）。开启时发送的文字末尾附加一个
 *   零宽空格（U+200B）作为隐形标记，客户端渲染层据此把这条 user 消息隐藏；
 *   agent 收到的仍是同样的文字，不影响任务恢复。
 */

/** 「继续文字」的 localStorage 键。 */
export const TEXT_KEY = 'dsh-webui:continue-btn:text'
/** 「不在对话中显示」开关的 localStorage 键（'1'/'0'）。 */
export const HIDE_KEY = 'dsh-webui:continue-btn:hide'

/**
 * 缺省继续文字：一个零宽空格。
 *
 * 为什么不是「继续」二字：DSH/协议层没有「无消息续跑」的入口——回合必须由一条
 * user 消息唤醒（session.prompt / agent.followup 都要求 UserMessage），所以
 * 「让它自己接着跑」在架构上做不到。折中方案是把唤醒消息压到最小：单个零宽
 * 空格既能唤醒回合、又几乎不占 token（1 个字符），且天然带隐藏标记，界面上
 * 完全看不见。想让模型明确读到指令时，可在设置里改成「继续」等文字。
 */
export const DEFAULT_TEXT = '\u200B'
/** 隐形标记字符：附加在继续文字末尾，用于渲染层识别并隐藏这条消息。 */
export const ZWSP = '\u200B'

/** 从 localStorage 读自定义文案；空值/损坏回退默认。 */
export function readText(): string {
  try {
    const raw = window.localStorage.getItem(TEXT_KEY)
    // 空字符串视为未设置；只含零宽字符的值是合法的（最小唤醒消息）。
    return raw !== null && raw !== '' ? raw : DEFAULT_TEXT
  } catch {
    return DEFAULT_TEXT
  }
}

/** 把自定义文案写入 localStorage（即输即存）。 */
export function writeText(value: string): void {
  try { window.localStorage.setItem(TEXT_KEY, value) } catch { /* ignore */ }
}

/** 读「不在对话中显示」开关；缺省视为开启（从未设置过也隐藏）。 */
export function readHide(): boolean {
  try {
    const raw = window.localStorage.getItem(HIDE_KEY)
    return raw === null ? true : raw !== '0'
  } catch {
    return true
  }
}

/** 写「不在对话中显示」开关。 */
export function writeHide(value: boolean): void {
  try { window.localStorage.setItem(HIDE_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

/**
 * 组装实际发送文本：隐藏开启时确保带零宽标记（已含则不重复追加）。
 * @param text - 用户配置的继续文字（默认即单个零宽空格）。
 * @param hide - 是否在对话流中隐藏这条消息。
 * @returns 实际提交给 agent 的文本。
 */
export function buildSendText(text: string, hide: boolean): string {
  if (!hide) return text
  return text.includes(ZWSP) ? text : text + ZWSP
}