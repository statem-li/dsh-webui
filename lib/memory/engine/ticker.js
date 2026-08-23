/**
 * dsh-memory 调度器：三个触发点（design §5.3）。
 * 1. 每 N 轮（默认 10）增量编译 timeline；
 * 2. 会话结束（turn/end 后 debounce 静默期）final 编译；
 * 3. 每日一次：全量衰减 → 短期折叠进长期 → 低分滚出 → daily 日志落盘 → 产物重编译。
 * 并发安全：所有写入经同一个串行队列（内存锁）执行。
 */
import { compileAll, promoteEntries, writeDailyLog } from './compile.js';
import { consolidateAll } from './consolidate.js';
import { decayImportance, shouldEvict } from './scoring.js';
import { localDate, nowIso, summarize, } from './store.js';
/** 会话结束判定静默期（毫秒）。 */
const SESSION_END_DEBOUNCE_MS = 15_000;
/** 每日检查定时器间隔（毫秒，仅兜底；正常由 turn/end 驱动）。 */
const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/**
 * 创建 ticker。返回 { onTurnEnd, enqueue, dispose }。
 * onTurnEnd 由 session/event 的 turn/end 分支调用；enqueue 供提取等写操作
 * 共用同一条串行队列（内存锁：避免 ticker 与捕获并发读写同一 store）。
 */
export function createTicker(ctx, store, config) {
    // 串行写队列（内存锁：ticker 与 turn/end 捕获共用同一 store 实例，串行化避免同日多写竞争）。
    let queue = Promise.resolve();
    const enqueue = (task) => {
        const result = queue.then(task);
        queue = result.then(() => undefined, () => undefined);
        return result;
    };
    const enqueueSafe = (task) => {
        enqueue(task).catch(error => {
            ctx.logger?.warn?.(`[dsh-memory] ticker task failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    };
    /** 每会话的 final 编译 debounce 计时器。 */
    const sessionEndTimers = new Map();
    /** 每日编译（幂等：lastDailyDate 前置判断，避免同日重复）。 */
    async function runDailyCompile() {
        const today = localDate();
        const state = await store.readState();
        const last = state.lastDailyDate;
        state.lastDailyDate = today;
        await store.writeState(state);
        if (last === today)
            return;
        const days = last === null ? 1 : Math.max(1, Math.floor((Date.parse(today) - Date.parse(last)) / 86_400_000));
        // 1-3) 衰减 → 折叠 → 滚出 → 原子写回（走 store 写队列，避免与提取/裁决并发覆盖）。
        let promoted = [];
        let evicted = [];
        await store.replaceEntries(entries => {
            const decayed = entries.map(entry => ({
                ...entry,
                importance: decayImportance(entry.importance, days, config.decayLambda),
            }));
            const result = promoteEntries(decayed, config.compileThreshold);
            promoted = result.promoted;
            const kept = [];
            evicted = [];
            for (const entry of result.remaining) {
                if (shouldEvict(entry, config.compileThreshold))
                    evicted.push(entry);
                else
                    kept.push(entry);
            }
            // 预算治理：条目数超上限时，按 importance+recency 淘汰低分条目（pinned 豁免）。
            let survivor = [...promoted, ...kept];
            if (survivor.length > config.entryLimit) {
                const overflow = survivor
                    .filter(entry => !entry.pinned)
                    .sort((a, b) => (a.importance - b.importance) || a.updatedAt.localeCompare(b.updatedAt))
                    .slice(0, survivor.length - config.entryLimit);
                const overflowIds = new Set(overflow.map(entry => entry.id));
                evicted.push(...overflow);
                survivor = survivor.filter(entry => !overflowIds.has(entry.id));
            }
            return survivor;
        });
        // 4) 变更流。
        for (const entry of promoted) {
            await store.appendChange({
                action: 'promote',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: summarize(entry.content),
            });
        }
        for (const entry of evicted) {
            await store.appendChange({
                action: 'delete',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: `低分条目滚出：${summarize(entry.content)}`,
            });
        }
        // 5) 产物重编译 + daily 日志。
        await compileAll(store, config);
        await writeDailyLog(store);
        ctx.logger?.debug?.(`[dsh-memory] daily compile done (promoted=${promoted.length}, evicted=${evicted.length})`);
        // 6) LLM 语义整理（Memory Dream）：合并去重 / 精炼重写 / 删除 / 提升长期。
        //    与规则整理正交：规则处理「分数」，本步处理「语义」。失败不阻塞（内部吞错）。
        if (config.consolidateEnabled) {
            const results = await consolidateAll(ctx, store, config, 'daily');
            const changed = results.reduce((sum, result) => sum + result.changed, 0);
            if (changed > 0) {
                ctx.logger?.debug?.(`[dsh-memory] daily consolidate done (scopes=${results.length}, changed=${changed})`);
            }
        }
    }
    /** 每 N 轮增量编译（timeline 重写）。 */
    async function runTurnCompile(sessionId, turnCount) {
        if (turnCount % config.compileEveryTurns !== 0)
            return;
        await compileAll(store, config);
        ctx.logger?.debug?.(`[dsh-memory] incremental compile (session=${sessionId}, turns=${turnCount})`);
    }
    /** 会话结束 final 编译（debounce）。 */
    function scheduleSessionEnd(sessionId) {
        const existing = sessionEndTimers.get(sessionId);
        if (existing !== undefined)
            clearTimeout(existing);
        const timer = setTimeout(() => {
            sessionEndTimers.delete(sessionId);
            enqueueSafe(async () => {
                await compileAll(store, config);
                await writeDailyLog(store);
                ctx.logger?.debug?.(`[dsh-memory] final compile (session=${sessionId})`);
            });
        }, SESSION_END_DEBOUNCE_MS);
        sessionEndTimers.set(sessionId, timer);
    }
    /** turn/end 统一入口（返回排队任务的 promise，供调用方串行衔接）。 */
    function onTurnEnd(sessionId, _agent) {
        const result = enqueue(async () => {
            const state = await store.readState();
            const per = state.perSession[sessionId] ?? { turnCount: 0, lastInjectedStep: 0 };
            per.turnCount += 1;
            state.perSession[sessionId] = per;
            // 日期切换 → 每日编译。
            const today = localDate();
            if (state.lastDailyDate !== today) {
                await store.writeState(state);
                if (config.dailyCompileEnabled)
                    await runDailyCompile();
            }
            else {
                await store.writeState(state);
            }
            // 每 N 轮增量编译。
            await runTurnCompile(sessionId, per.turnCount);
        });
        scheduleSessionEnd(sessionId);
        return result;
    }
    // 兜底每日检查（每小时；正常情况 turn/end 已驱动）。
    const timerService = ctx.get('timer');
    const checkInterval = timerService?.interval(() => {
        enqueueSafe(async () => {
            const state = await store.readState();
            const today = localDate();
            if (state.lastDailyDate !== today && config.dailyCompileEnabled) {
                await runDailyCompile();
            }
        });
    }, DAILY_CHECK_INTERVAL_MS);
    function dispose() {
        if (typeof checkInterval === 'function')
            checkInterval();
        for (const timer of sessionEndTimers.values())
            clearTimeout(timer);
        sessionEndTimers.clear();
    }
    return { onTurnEnd, enqueue, dispose };
}
/** 会话级 ticker 状态读取（供 inject 用，避免重复读文件）。 */
export async function sessionTurnCount(store, sessionId) {
    const state = await store.readState();
    return state.perSession[sessionId]?.turnCount ?? 0;
}
/** 当前时间 ISO（供 change 记录）。 */
export function tickerNow() {
    return nowIso();
}
//# sourceMappingURL=ticker.js.map