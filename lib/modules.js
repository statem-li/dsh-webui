/**
 * webui — 功能模块清单与开关解析（host / client 两端共用）。
 *
 * dsh-webui 是全家桶插件，但并非所有用户都需要全部能力。本模块定义一份
 * 统一的功能模块 key 清单，两端按同一份语义裁剪：
 *
 *  - host 半身（src/index.ts）：为 false 的模块不装配（工具 / provider /
 *    HTTP API / settings 命名空间都不注册）。
 *  - client 半身（src/client/index.ts）：为 false 的模块不注册 UI 槽位
 *    （设置卡、面板入口、shadow、样式注入等）。
 *
 * 配置通道：
 *  - host：settings 命名空间 `webui-modules`（settings.yaml 持久化），
 *    经 GET/POST `/api/webui-modules` 暴露给浏览器端。改动后**重启 DSH 生效**
 *    （host 模块在插件加载时一次性装配，不做运行时卸载）。
 *  - client：启动时同步读 localStorage 缓存（`dsh-webui.modules`）立即生效；
 *    后台 fetch `/api/webui-modules` 校正缓存，下次刷新对齐服务端配置。
 *
 * 语义：**缺省 = 启用**；只有显式 `false` 才关闭（`isModuleEnabled`）。
 * 这样 localStorage / settings 里只需要存「被关掉的那几项」，升级新增模块时
 * 老配置自动保持启用。
 */
/** 全部可开关的功能模块 key（与 README「功能总览」分组对应）。 */
export const WEBUI_MODULE_KEYS = [
    // ── 对话体验 ──
    'messageWidth', // 消息气泡宽度设置
    'voice', // 语音播报（实时播报 + 对话完成总结播报）
    'doneSound', // 回合结束提示音 + 完成卡片
    'donePill', // 对话完成胶囊 + 记录面板
    'approvalNotify', // 审批等待 toast 提醒
    'ctrlEnter', // 输入框 Ctrl+Enter 换行
    'continueBtn', // 一键继续（中断态下发送键/Enter 自动代填恢复任务）
    'sessionMotion', // 会话切换柔和过渡
    'sessionPin', // 会话置顶 / 归档 / 右键菜单
    'rewind', // 对话退回（文件回退 + 上下文分支）
    'screenshot', // 对话截图（回复/问答/整段会话 × 电脑/手机 × 1080P/2K/4K × 自适应/16:9 等画幅）
    'promptOptimize', // 提示词优化图标
    'zhThinking', // 中文思考开关
    'mood', // MOOD 自述（按 Agent 预设的开关 + 人设 + 对话流卡片）
    'peakValley', // DeepSeek 峰谷时刻卡片
    'chatStats', // 会话统计条 shadow
    'toolSummary', // 工具调用聚合 + 活动抽屉
    'diagram', // mermaid 流程图/架构图渲染（引擎按需加载）+ 作图提示词
    // ── 模型与供应商 ──
    'reasoningSync', // webui_sync_reasoning 推理等级补全工具
    'modelSeats', // 模型座位接管 + 推理等级弹出
    'providerHub', // 供应商管理设置页
    'vision', // 辅助视觉 + 生图 + 生视频 + 生图画廊
    'webSearch', // AnySearch 网页搜索
    'mail', // 邮箱验证码
    // ── 技能 ──
    'skills', // 技能 slash 两级导航源 + 技能开关路由
    // ── AI 浏览器 ──
    'browser', // AI 浏览器 host 工具 + dock UI + 设置开关
    // ── 自动化与计划 ──
    'automation', // 定时自动化（openhanako 式 cron/at/every 任务 + Agent Run 执行）
    'planweave', // PlanWeave 计划项目
    'team', // 团队 Agent 编排器（多团队/多角色接力 + 对话框团队开关 + 执行 HUD）
    // ── 记忆 ──
    'memory', // 记忆引擎 + Memory Dream
    // ── 用量与统计 ──
    'usage', // 用量工作台（趋势/热力图/账户）
    // ── 文件与工作区 ──
    'fileExplorer', // 文件浏览器
    'dirPicker', // 工作区目录选择器
    'tmpCleaner', // 工作区临时垃圾清理器（_tmp 约定目录 + 规则扫描）
    // ── 外观与系统 ──
    'appearance', // 玻璃质感主题
    'sidebarFloat', // 悬浮侧边栏
    'updater', // 壳管理更新
    'pluginUpdate', // 插件自更新（检测上游新版本 + 一键就地更新）
    'proxy', // 网络代理
];
const KEY_SET = new Set(WEBUI_MODULE_KEYS);
/**
 * 从任意来源（settings 值 / localStorage JSON / API body）提取合法的部分
 * 覆盖表：丢弃未知 key 与非布尔值，绝不抛错。
 */
export function normalizeModules(input) {
    const out = {};
    if (input === null || typeof input !== 'object')
        return out;
    for (const [key, value] of Object.entries(input)) {
        if (!KEY_SET.has(key))
            continue;
        if (typeof value === 'boolean')
            out[key] = value;
    }
    return out;
}
/**
 * 判定某模块是否启用：缺省 = 启用，只有显式 false 关闭。
 */
export function isModuleEnabled(modules, key) {
    return modules[key] !== false;
}
//# sourceMappingURL=modules.js.map