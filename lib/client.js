window.__ModuleLoader__.load({
	id: "@dsh-external/webui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/styles.ts
		/**
		* webui — 会话 Web UI 插件样式（运行时注入 <style>，卸载时移除）。
		* 类名前缀 webui-；颜色走 DSH 主题令牌（--dsw-alias-*），缺省兜底深色值。
		*/
		const css = {
			host: "webui-host",
			viewTile: "webui-view-tile",
			viewTileActive: "webui-view-tile-active",
			trigger: "webui-trigger",
			triggerBadge: "webui-trigger-badge",
			popup: "webui-popup",
			popupHead: "webui-popup-head",
			popupList: "webui-popup-list",
			item: "webui-item",
			itemIndex: "webui-item-index",
			itemMeta: "webui-item-meta",
			itemText: "webui-item-text",
			loadOlder: "webui-load-older",
			panel: "webui-panel",
			scroller: "webui-scroller",
			row: "webui-row",
			bar: "webui-bar",
			barActive: "webui-bar-active",
			tip: "webui-tip",
			tipHead: "webui-tip-head",
			tipMeta: "webui-tip-meta",
			tipBody: "webui-tip-body",
			flash: "webui-flash"
		};
		const STYLE_ID = "dsh-webui-styles";
		const SHEET = `
/* 视图图块 + 消息按钮一行（右上角 utilities 区，与 Session log 同行） */
.webui-host{display:flex;align-items:center;gap:8px;position:relative;flex:none}
/* 图块按钮（对话/轨迹） */
.webui-view-tile{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-tertiary,#888);font-size:13px;line-height:16px;font-weight:500;cursor:pointer;white-space:nowrap;transition:border-color .12s,color .12s,background .12s,box-shadow .12s}
.webui-view-tile:hover{border-color:var(--dsw-alias-border-l1,#555);color:var(--dsw-alias-label-primary,#ddd)}
.webui-view-tile-active{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent)}
.webui-view-tile-active:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
/* 隐藏原生「对话/轨迹」标签页行（视图切换改由右上角图块接管） */
[data-slot="conversation.session.header"] [role="tablist"]{display:none}
/* 原生标签页行移除后 header 变矮，补底部留白避免图块贴住分割线 */
[data-slot="conversation.session.header"] > header{padding-bottom:10px}
/* 消息数量按钮（内联，仅数量徽标） */
.webui-trigger{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 2px;border:none;background:transparent;cursor:pointer}
.webui-trigger-badge{flex:0 0 auto;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--dsw-alias-state-business-primary,#4a9eff);color:#fff;font-size:11px;line-height:20px;text-align:center;font-weight:600;transition:transform 120ms, box-shadow 120ms}
.webui-trigger:hover .webui-trigger-badge{transform:scale(1.1);box-shadow:0 0 8px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 60%,transparent)}
.webui-trigger[aria-expanded="true"] .webui-trigger-badge{transform:scale(1.1)}
.webui-popup{position:fixed;z-index:1200;width:min(420px, calc(100vw - 24px));max-height:min(480px, 60vh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 32px rgba(0,0,0,.45));overflow:hidden}
.webui-popup-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);border-bottom:1px solid var(--dsw-alias-border-l3,#2a2d35)}
.webui-popup-head small{color:var(--dsw-alias-label-tertiary,#888);font-weight:400}
.webui-popup-list{overflow-y:auto;overscroll-behavior:contain;padding:6px;display:flex;flex-direction:column;gap:2px}
.webui-popup-list::-webkit-scrollbar{width:8px}
.webui-popup-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333);border-radius:4px}
.webui-item{display:grid;grid-template-columns:34px 84px 1fr;gap:8px;align-items:baseline;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#ddd);text-align:left;cursor:pointer;font:inherit;font-size:12px;line-height:1.5}
.webui-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.webui-item-index{color:var(--dsw-alias-label-tertiary,#888);font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px}
.webui-item-meta{color:var(--dsw-alias-label-tertiary,#888);font-size:11px;white-space:nowrap}
.webui-item-text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;color:var(--dsw-alias-label-secondary,#bbb)}
.webui-load-older{margin:4px 6px 2px;padding:6px 10px;border:1px dashed var(--dsw-alias-border-l2,#333);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:11px;cursor:pointer}
.webui-load-older:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
.webui-load-older:disabled{opacity:.5;cursor:default}
/* 无背景横条面板：只显示横条本身；无滚动条（超出由滚轮平滑滚动） */
.webui-panel{position:fixed;z-index:1100;padding:6px 8px;overflow:hidden;cursor:default;touch-action:none;user-select:none;background:transparent}
.webui-scroller{display:flex;flex-direction:column;gap:2px;will-change:transform}
.webui-row{width:100%;height:18px;display:flex;align-items:center;justify-content:flex-end;flex:0 0 auto}
.webui-bar{display:block;width:15px;height:5px;padding:0;border:none;border-radius:3px;background:var(--dsw-alias-scrollbar-bg-l2,#667085);opacity:.6;cursor:pointer;flex:0 0 auto;transition:width .16s ease,background .12s,opacity .12s}
.webui-bar:hover{opacity:1;background:var(--dsw-alias-scrollbar-hover-l2,#8a94a8)}
.webui-bar-active{width:23px;background:var(--dsw-alias-state-business-primary,#4a9eff);opacity:1;box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 55%,transparent)}
.webui-bar-active:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 78%,#fff)}
.webui-tip{position:fixed;z-index:1300;width:300px;max-height:180px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-3,#1b1e24));box-shadow:var(--dsw-shadow-lv2,0 4px 20px rgba(0,0,0,.4));pointer-events:none;overflow:hidden}
.webui-tip-head{display:flex;gap:8px;align-items:baseline;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);white-space:nowrap}
.webui-tip-meta{color:var(--dsw-alias-label-tertiary,#888);font-weight:400;font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace)}
.webui-tip-body{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical}
.webui-flash{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px;border-radius:8px;animation:webui-flash-pulse 2.4s ease-out}
@keyframes webui-flash-pulse{0%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 22%,transparent)}60%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 10%,transparent)}100%{background:transparent}}
`;
		let injected = false;
		/** 注入全局样式（幂等）；返回移除函数。 */
		function injectStyles() {
			if (!injected) {
				const tag = document.createElement("style");
				tag.id = STYLE_ID;
				tag.dataset.plugin = "@dsh-external/webui";
				tag.dataset.pluginCss = "webui/styles";
				tag.textContent = SHEET;
				document.head.appendChild(tag);
				injected = true;
			}
			return () => {
				if (!injected) return;
				document.getElementById(STYLE_ID)?.remove();
				injected = false;
			};
		}
		//#endregion
		//#region src/client/Webui.tsx
		/**
		* Webui — 会话 Web UI 插件核心组件（client 半身）。
		*
		* 能力：
		*  1. 右上角「对话/轨迹」图块按钮：接管原生标签页，做成图块并排放在
		*     右上角 utilities 区（与 Session log 同行）；点击切换会话视图。
		*  2. 右上角「消息 N」按钮 → 弹出本会话全部已发送消息（user + steering）；
		*     点击某条 → 会话自动滚动到该消息并高亮闪烁。
		*  3. 右侧中间「消息横条」：透明无背景的一列细横条，每条横条 = 一条你
		*     发送的消息；点击跳转、悬停预览、按住空白处拖动滚动会话。
		*
		* 依赖 DOM 契约（ui-conversation 稳定提供）：
		*  - [data-phase] — 会话根（含 [role="tablist"] 原生标签页）
		*  - [data-conversation-scroll] — 会话滚动容器（scrollport）
		*  - [data-chat-flow] — 聊天流列表
		*  - [data-chat-anchor-key] — 每个聊天节点行的稳定锚点（= node.key）
		*  - [data-composer-seat] — 底部粘贴输入区
		*/
		const PANEL_WIDTH = 196;
		/** 行高估算（18px 行 + 2px 间距），用于面板高度计算。 */
		const PANEL_ROW_HEIGHT = 20;
		const PANEL_PADDING = 16;
		/** 消息弹窗最大宽度（右对齐定位用）。 */
		const POPUP_WIDTH = 420;
		function clamp(value, lo, hi) {
			return Math.min(hi, Math.max(lo, value));
		}
		/** 内容块 → 纯文本预览（图片/工具块给占位符）。 */
		function blocksText(content) {
			const parts = [];
			for (const block of content) switch (block.type) {
				case "text":
					parts.push(block.text);
					break;
				case "reasoning":
					parts.push("[思考]");
					break;
				case "image":
					parts.push("[图片]");
					break;
				case "tool-call":
					parts.push(`[工具：${block.name}]`);
					break;
				case "tool-result":
					parts.push("[工具结果]");
					break;
				default: parts.push("[内容]");
			}
			return parts.join("\n").trim();
		}
		/** 用户消息节点 → 预览文本。 */
		function messageText(node) {
			switch (node.kind) {
				case "user":
				case "steering":
				case "context": return blocksText(node.data.content);
				default: return "";
			}
		}
		/** 用户消息节点 → 时间戳。 */
		function messageTime(node) {
			switch (node.kind) {
				case "user":
				case "steering":
				case "context": return node.data.time;
				default: return 0;
			}
		}
		function formatTime(ts) {
			if (ts <= 0) return "";
			const d = new Date(ts);
			const now = /* @__PURE__ */ new Date();
			const hh = String(d.getHours()).padStart(2, "0");
			const mm = String(d.getMinutes()).padStart(2, "0");
			if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
			return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}:${mm}`;
		}
		function truncate(text, max) {
			const flat = text.replace(/\s+/g, " ").trim();
			return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
		}
		/**
		* 会话 Web UI 入口：右上角「对话/轨迹」图块 + 「消息」按钮 + 消息弹窗 +
		* 右侧消息横条面板。
		* @param props - 会话标准套件（sessionId / useSession 等，框架注入）。
		*/
		function Webui(props) {
			const { sessionId, useSession } = props;
			const snapshot = useSession((s) => s);
			const hostRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const scrollerRef = (0, react.useRef)(null);
			const wrapRef = (0, react.useRef)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [popupPos, setPopupPos] = (0, react.useState)(null);
			const [panelPos, setPanelPos] = (0, react.useState)(null);
			const [tabs, setTabs] = (0, react.useState)([]);
			const [activeKey, setActiveKey] = (0, react.useState)(null);
			const [hover, setHover] = (0, react.useState)(null);
			const measureRef = (0, react.useRef)(() => {});
			const scrollPosRef = (0, react.useRef)(0);
			const scrollTargetRef = (0, react.useRef)(0);
			const scrollRafRef = (0, react.useRef)(0);
			const dragRef = (0, react.useRef)(null);
			const userMessages = (0, react.useMemo)(() => {
				const chat = snapshot?.chat;
				if (chat === void 0) return [];
				const out = [];
				for (const key of chat.order) {
					const node = chat.nodes.get(key);
					if (node === void 0 || node.visibility === "hidden") continue;
					if (node.kind === "user" || node.kind === "steering") out.push({
						key,
						node
					});
				}
				return out;
			}, [snapshot]);
			const bars = (0, react.useMemo)(() => userMessages.map((entry, index) => ({
				key: entry.key,
				index,
				seq: entry.node.anchorSeq,
				time: messageTime(entry.node),
				full: messageText(entry.node)
			})), [userMessages]);
			const scrollportOf = (0, react.useCallback)(() => {
				const rootEl = hostRef.current;
				if (rootEl === null) return null;
				const found = rootEl.closest("[data-phase]")?.querySelector("[data-conversation-scroll]") ?? document.querySelector("[data-conversation-scroll]");
				return found instanceof HTMLElement ? found : null;
			}, []);
			const findRow = (0, react.useCallback)((scrollport, key) => {
				for (const row of scrollport.querySelectorAll("[data-chat-anchor-key]")) if (row.dataset.chatAnchorKey === key) return row;
				return null;
			}, []);
			/** 滚动到某节点并高亮闪烁。 */
			const jumpTo = (0, react.useCallback)((key) => {
				const scrollport = scrollportOf();
				if (scrollport === null) return;
				const row = findRow(scrollport, key);
				if (row === null) return;
				const sr = scrollport.getBoundingClientRect();
				const rr = row.getBoundingClientRect();
				const target = scrollport.scrollTop + (rr.top - sr.top);
				scrollport.scrollTo({
					top: target,
					behavior: "smooth"
				});
				row.classList.add(css.flash);
				window.setTimeout(() => {
					row.classList.remove(css.flash);
				}, 2400);
			}, [scrollportOf, findRow]);
			/** 读取原生 tablist（对话/轨迹）投影为图块信息。 */
			const readTabs = (0, react.useCallback)(() => {
				const tablist = (hostRef.current?.closest("[data-phase]"))?.querySelector("[role=\"tablist\"]");
				if (!(tablist instanceof HTMLElement)) return [];
				return [...tablist.querySelectorAll("[role=\"tab\"]")].map((tab) => ({
					label: tab.textContent?.trim() ?? "",
					selected: tab.getAttribute("aria-selected") === "true"
				}));
			}, []);
			/** 点击第 index 个图块 → 触发对应原生标签页的 click（复用视图切换逻辑）。 */
			const selectView = (0, react.useCallback)((index) => {
				const tab = ((hostRef.current?.closest("[data-phase]"))?.querySelectorAll("[role=\"tablist\"] [role=\"tab\"]"))?.[index];
				if (tab instanceof HTMLElement) tab.click();
			}, []);
			(0, react.useLayoutEffect)(() => {
				const sync = () => {
					setTabs((prev) => {
						const next = readTabs();
						if (prev.length === next.length && prev.every((t, i) => t.label === next[i]?.label && t.selected === next[i]?.selected)) return prev;
						return next;
					});
				};
				sync();
				const tablist = (hostRef.current?.closest("[data-phase]"))?.querySelector("[role=\"tablist\"]");
				if (!(tablist instanceof HTMLElement)) return;
				const observer = new MutationObserver(sync);
				observer.observe(tablist, {
					attributes: true,
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
				};
			}, [sessionId, readTabs]);
			measureRef.current = (0, react.useCallback)(() => {
				const scrollport = scrollportOf();
				if (scrollport === null || bars.length === 0) {
					setPanelPos(null);
					return;
				}
				const sr = scrollport.getBoundingClientRect();
				const composerTop = scrollport.querySelector("[data-composer-seat]")?.getBoundingClientRect().top;
				const visibleBottom = composerTop !== void 0 && composerTop > sr.top ? composerTop : sr.bottom;
				const flow = scrollport.querySelector("[data-chat-flow]");
				let lastAbove = null;
				let firstVisibleUser = null;
				if (flow !== null) for (const row of flow.querySelectorAll("[data-chat-anchor-key]")) {
					const key = row.dataset.chatAnchorKey;
					if (key === void 0) continue;
					const node = snapshot?.chat.nodes.get(key);
					if (node === void 0 || node.kind !== "user" && node.kind !== "steering") continue;
					const rect = row.getBoundingClientRect();
					if (rect.height <= 0) continue;
					if (rect.bottom <= sr.top + 1) lastAbove = key;
					else if (rect.top < visibleBottom && firstVisibleUser === null) firstVisibleUser = key;
				}
				const active = firstVisibleUser ?? lastAbove;
				setActiveKey((prev) => prev === active ? prev : active);
				const panelHeight = clamp(bars.length * PANEL_ROW_HEIGHT + PANEL_PADDING, 56, 216);
				const x = sr.left + scrollport.clientWidth - PANEL_WIDTH - 12;
				const y = sr.top + Math.max(24, (sr.height - panelHeight) / 2);
				setPanelPos((prev) => prev !== null && Math.abs(prev.x - x) < .5 && Math.abs(prev.y - y) < .5 ? prev : {
					x,
					y
				});
			}, [
				scrollportOf,
				snapshot,
				bars.length
			]);
			(0, react.useLayoutEffect)(() => {
				const removeStyles = injectStyles();
				measureRef.current();
				const scrollport = scrollportOf();
				if (scrollport === null) return removeStyles;
				let raf = 0;
				const schedule = () => {
					if (raf !== 0) return;
					raf = window.requestAnimationFrame(() => {
						raf = 0;
						measureRef.current();
					});
				};
				const onScroll = () => {
					schedule();
				};
				scrollport.addEventListener("scroll", onScroll, { passive: true });
				window.addEventListener("resize", onScroll);
				let resizeObserver = null;
				let mutationObserver = null;
				if (typeof ResizeObserver !== "undefined") {
					resizeObserver = new ResizeObserver(schedule);
					const flow = scrollport.querySelector("[data-chat-flow]");
					if (flow !== null) resizeObserver.observe(flow);
					resizeObserver.observe(scrollport);
				}
				if (typeof MutationObserver !== "undefined") {
					mutationObserver = new MutationObserver(schedule);
					mutationObserver.observe(scrollport, {
						childList: true,
						subtree: true
					});
				}
				return () => {
					scrollport.removeEventListener("scroll", onScroll);
					window.removeEventListener("resize", onScroll);
					resizeObserver?.disconnect();
					mutationObserver?.disconnect();
					if (raf !== 0) window.cancelAnimationFrame(raf);
					removeStyles();
				};
			}, [sessionId, scrollportOf]);
			(0, react.useEffect)(() => {
				if (!open) {
					setPopupPos(null);
					return;
				}
				const trigger = triggerRef.current;
				if (trigger === null) return;
				const rect = trigger.getBoundingClientRect();
				const width = Math.min(POPUP_WIDTH, window.innerWidth - 24);
				setPopupPos({
					x: Math.max(8, Math.min(rect.right, window.innerWidth - 12) - width),
					y: rect.bottom + 8
				});
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (event.target instanceof Node && !hostRef.current?.contains(event.target) && !wrapRef.current?.contains(event.target)) setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", closeOutside);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", closeOutside);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			(0, react.useEffect)(() => () => {
				dragRef.current = null;
			}, []);
			const applyScroll = (0, react.useCallback)((target, smooth) => {
				const panel = panelRef.current;
				const scroller = scrollerRef.current;
				if (panel === null || scroller === null) return;
				const t = clamp(target, 0, Math.max(0, scroller.scrollHeight - panel.clientHeight));
				scrollTargetRef.current = t;
				if (!smooth) {
					scrollPosRef.current = t;
					scroller.style.transform = `translateY(${-t}px)`;
					if (scrollRafRef.current !== 0) cancelAnimationFrame(scrollRafRef.current);
					scrollRafRef.current = 0;
					return;
				}
				if (scrollRafRef.current !== 0) return;
				const tick = () => {
					const s = scrollerRef.current;
					if (s === null) {
						scrollRafRef.current = 0;
						return;
					}
					const pos = scrollPosRef.current;
					const goal = scrollTargetRef.current;
					const next = pos + (goal - pos) * .18;
					if (Math.abs(goal - next) < .5) {
						scrollPosRef.current = goal;
						s.style.transform = `translateY(${-goal}px)`;
						scrollRafRef.current = 0;
						return;
					}
					scrollPosRef.current = next;
					s.style.transform = `translateY(${-next}px)`;
					scrollRafRef.current = requestAnimationFrame(tick);
				};
				scrollRafRef.current = requestAnimationFrame(tick);
			}, []);
			(0, react.useEffect)(() => {
				const panel = panelRef.current;
				if (panel === null) return;
				const onWheel = (event) => {
					const scroller = scrollerRef.current;
					if (scroller === null) return;
					if (Math.max(0, scroller.scrollHeight - panel.clientHeight) <= 0) {
						scrollPosRef.current = 0;
						scrollTargetRef.current = 0;
						return;
					}
					event.preventDefault();
					applyScroll(scrollTargetRef.current + event.deltaY, true);
				};
				panel.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					panel.removeEventListener("wheel", onWheel);
					if (scrollRafRef.current !== 0) cancelAnimationFrame(scrollRafRef.current);
					scrollRafRef.current = 0;
					scrollPosRef.current = 0;
					scrollTargetRef.current = 0;
				};
			}, [
				panelPos,
				bars.length,
				applyScroll
			]);
			(0, react.useEffect)(() => {
				if (activeKey === null || panelRef.current === null) return;
				const panel = panelRef.current;
				let row = null;
				for (const el of panel.querySelectorAll("[data-bar-key]")) if (el.dataset.barKey === activeKey) {
					row = el;
					break;
				}
				if (row === null) return;
				applyScroll(row.offsetTop - (panel.clientHeight - row.offsetHeight) / 2, true);
			}, [
				activeKey,
				bars.length,
				applyScroll
			]);
			const onPanelPointerDown = (event) => {
				if (event.target instanceof HTMLElement && event.target.closest("button") !== null) return;
				const scrollport = scrollportOf();
				if (scrollport === null) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				dragRef.current = {
					down: true,
					dragging: false,
					moved: 0,
					startX: event.clientX,
					startY: event.clientY,
					startScrollTop: scrollport.scrollTop
				};
			};
			const onPanelPointerMove = (event) => {
				const drag = dragRef.current;
				if (drag === null || !drag.down) return;
				drag.moved += Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
				if (!drag.dragging && drag.moved > 6) drag.dragging = true;
				if (!drag.dragging) return;
				const scrollport = scrollportOf();
				if (scrollport === null) return;
				const max = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
				scrollport.scrollTop = clamp(drag.startScrollTop + (event.clientY - drag.startY) * 2, 0, max);
			};
			const onPanelPointerUp = (event) => {
				const drag = dragRef.current;
				dragRef.current = null;
				if (drag === null) return;
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {}
			};
			const totalCount = userMessages.length;
			const showButton = totalCount > 0;
			const showPanel = panelPos !== null && bars.length >= 1;
			const hoverBar = hover === null ? null : bars.find((bar) => bar.key === hover.key) ?? null;
			const loadOlder = (0, react.useCallback)(() => {
				const button = (scrollportOf()?.querySelector("[data-chat-flow]"))?.querySelector("button");
				if (button instanceof HTMLButtonElement && !button.disabled) button.click();
			}, [scrollportOf]);
			const autoLoadRef = (0, react.useRef)({
				attempts: 0,
				lastCount: -1
			});
			(0, react.useEffect)(() => {
				if (snapshot?.openState !== "open") return;
				if (snapshot?.hasMore !== true || snapshot?.loadingOlder === true) return;
				const state = autoLoadRef.current;
				if (state.attempts >= 8 && bars.length === state.lastCount) return;
				const timer = window.setTimeout(() => {
					state.lastCount = bars.length;
					state.attempts += 1;
					loadOlder();
				}, 400);
				return () => {
					window.clearTimeout(timer);
				};
			}, [
				snapshot?.openState,
				snapshot?.hasMore,
				snapshot?.loadingOlder,
				bars.length,
				loadOlder
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: hostRef,
				className: css.host,
				children: [
					tabs.map((tab, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: [css.viewTile, tab.selected ? css.viewTileActive : ""].filter(Boolean).join(" "),
						"aria-pressed": tab.selected,
						onClick: () => {
							selectView(index);
						},
						children: tab.label
					}, `${index}-${tab.label}`)),
					showButton && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						ref: triggerRef,
						type: "button",
						className: css.trigger,
						"aria-haspopup": "listbox",
						"aria-expanded": open,
						"aria-label": `查看本会话已发送消息，共 ${totalCount} 条`,
						title: "查看本会话全部已发送消息",
						onClick: () => {
							setOpen((prev) => !prev);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: css.triggerBadge,
							children: totalCount
						})
					}),
					open && popupPos !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: wrapRef,
						className: css.popup,
						role: "listbox",
						"aria-label": "会话消息列表",
						style: {
							left: popupPos.x,
							top: popupPos.y
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.popupHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "消息列表" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
								"共 ",
								totalCount,
								" 条已发送 · ",
								sessionId
							] })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.popupList,
							children: [userMessages.map((entry, index) => {
								const node = entry.node;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "option",
									className: css.item,
									onClick: () => {
										jumpTo(entry.key);
										setOpen(false);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: css.itemIndex,
											children: String(index + 1).padStart(2, "0")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: css.itemMeta,
											children: formatTime(messageTime(node))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: css.itemText,
											children: truncate(messageText(node), 160) || "(空消息)"
										})
									]
								}, entry.key);
							}), snapshot?.hasMore === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: css.loadOlder,
								disabled: snapshot.loadingOlder === true,
								onClick: loadOlder,
								children: snapshot.loadingOlder === true ? "加载中…" : "更早的消息尚未加载 — 点击加载"
							})]
						})]
					}), document.body),
					showPanel && panelPos !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: panelRef,
						className: css.panel,
						style: {
							left: panelPos.x,
							top: panelPos.y,
							width: PANEL_WIDTH,
							height: clamp(bars.length * PANEL_ROW_HEIGHT + PANEL_PADDING, 56, 216)
						},
						onPointerDown: onPanelPointerDown,
						onPointerMove: onPanelPointerMove,
						onPointerUp: onPanelPointerUp,
						onPointerLeave: () => {
							setHover(null);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							ref: scrollerRef,
							className: css.scroller,
							children: bars.map((bar) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								"data-bar-key": bar.key,
								className: css.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: [css.bar, bar.key === activeKey ? css.barActive : ""].filter(Boolean).join(" "),
									"aria-label": `跳转到我的第 ${bar.index + 1} 条消息`,
									onMouseEnter: (event) => {
										const rect = event.currentTarget.getBoundingClientRect();
										setHover({
											key: bar.key,
											y: rect.top + rect.height / 2
										});
									},
									onClick: () => {
										jumpTo(bar.key);
									}
								})
							}, bar.key))
						})
					}), document.body),
					hoverBar !== null && panelPos !== null && hover !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.tip,
						style: {
							left: panelPos.x - 312 < 8 ? panelPos.x + PANEL_WIDTH + 12 : panelPos.x - 312,
							top: clamp(hover.y - 20, 8, window.innerHeight - 196)
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.tipHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "我" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: css.tipMeta,
								children: [hoverBar.seq > 0 ? `#${hoverBar.seq} · ` : "", formatTime(hoverBar.time)]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: css.tipBody,
							children: hoverBar.full !== "" ? truncate(hoverBar.full, 400) : "(空消息)"
						})]
					}), document.body)
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "webui",
				order: 10
			}, Webui));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map