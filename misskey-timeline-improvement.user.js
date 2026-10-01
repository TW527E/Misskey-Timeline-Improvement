// ==UserScript==
// @name               Misskey Timeline Improvement
// @name:zh-TW         Misskey 時間線改善：返回時回到原位
// @name:zh-CN         Misskey 时间线改善：返回时回到原位
// @name:ja            Misskey タイムライン改善：戻ったときに元の位置へ
// @namespace          https://github.com/TW527E/Misskey-Timeline-Improvement
// @version            0.1.0
// @description        Like Twitter/X: open a note, go back, and the Misskey / Sharkey timeline is exactly where you left off — even after the page cache was evicted, the tab was reloaded, or you switched timeline tabs.
// @description:zh-TW  像推特一樣：點開貼文後按返回，Misskey / Sharkey 的時間線會回到你離開時的位置（頁面快取被清掉、重新整理、切換時間線分頁也一樣）。
// @description:zh-CN  像推特一样：点开帖子后按返回，Misskey / Sharkey 的时间线会回到你离开时的位置（页面缓存被清除、刷新、切换时间线标签也一样）。
// @description:ja     Twitter/X のように、ノートを開いて戻ると Misskey / Sharkey のタイムラインが元の位置に戻ります（ページキャッシュが破棄された場合・再読み込み・タブ切り替えにも対応）。
// @author             誠誠-ChengCheng
// @license            MIT
// @homepageURL        https://github.com/TW527E/Misskey-Timeline-Improvement
// @supportURL         https://github.com/TW527E/Misskey-Timeline-Improvement/issues
// @downloadURL        https://raw.githubusercontent.com/TW527E/Misskey-Timeline-Improvement/main/misskey-timeline-improvement.user.js
// @updateURL          https://raw.githubusercontent.com/TW527E/Misskey-Timeline-Improvement/main/misskey-timeline-improvement.user.js
// @match              *://*/*
// @run-at             document-start
// @grant              none
// @noframes
// ==/UserScript==

/*
 * How it works
 * ------------
 * Misskey / Sharkey render every timeline item with a `data-scroll-anchor="<note id>"`
 * attribute inside a page scroll container (`._pageScrollable`).
 *
 * 1. While you scroll, we remember which note is at the top of the viewport and its exact
 *    pixel offset. The record is kept per browser-history entry and per timeline tab, in
 *    sessionStorage, so it survives reloads and tab discards.
 * 2. When you come back (back/forward, reload, or switching back to a timeline tab), we find
 *    that note again and put it at the exact same offset. If the timeline was re-created from
 *    scratch (e.g. the page cache evicted it), we press "load more" for you until the note
 *    shows up.
 *
 * The script only touches the DOM and the History API; it never calls the Misskey API itself.
 */
(function () {
	'use strict';

	const VERSION = '0.1.0';
	const NS = 'misskey-timeline-improvement';

	/**
	 * Settings. To change them without editing this file (so updates don't overwrite them),
	 * run this in the browser console on your instance and reload:
	 *   localStorage.setItem('misskey-timeline-improvement:config', JSON.stringify({ restoreOnReload: false }))
	 */
	const DEFAULT_CONFIG = {
		/** Restore the position when navigating back / forward. */
		restoreOnBack: true,
		/** Restore the position after reloading the page (or when the browser revives a discarded tab). */
		restoreOnReload: true,
		/** Give every timeline tab (Home / Local / Social / ...) its own remembered position. */
		restoreOnTabSwitch: true,
		/** How many times "load more" may be pressed to find the note you left off at. */
		maxLoadPages: 30,
		/** Same, for lists that are not ordered by time (e.g. recommendation feeds). */
		maxLoadPagesUnordered: 5,
		/** Show a small progress toast while older notes are being loaded. */
		showToast: true,
		/** Log what the script is doing to the console. */
		debug: false,
	};

	const CONFIG = Object.assign({}, DEFAULT_CONFIG, readJson(safeLocalStorage(), NS + ':config'));

	const ANCHOR = '[data-scroll-anchor]';
	const STORE_KEY = NS + ':state';
	const HISTORY_KEY = '__mtiKey';
	const MAX_ENTRIES = 100;
	const MAX_TABS_PER_ENTRY = 12;
	const PENDING_TIMEOUT = 20000;
	const NO_SNAPSHOT_GRACE = 1500;
	const SETTLE_MS = 1500;
	const RESTORE_DEADLINE = 60000;

	let enabled = false;
	/** The history entry currently shown: { key, path }. */
	const cur = { key: null, path: currentPath() };
	/** A restore waiting for the target page to render: { key, reason, since, ignore, seenAt }. */
	let pending = null;
	/** The restore in progress: { cancelled }. */
	let restoring = null;
	let lastResult = null;
	let store = { v: 1, entries: {} };

	/** List roots we've already seen, and which timeline identity each one belongs to. */
	const seenLists = new WeakSet();
	const listIdentity = new WeakMap();

	// The popstate listener is registered as early as possible and in the capture phase so it
	// runs before Misskey's router swaps the page: the DOM still shows the page being left.
	window.addEventListener('popstate', onPopState, true);

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', detect, { once: true });
	} else {
		detect();
	}

	// ---------------------------------------------------------------------------------------
	// Setup

	function detect() {
		if (looksLikeMisskey()) {
			init();
			return;
		}
		// Some forks rename the <meta>; the app root is created a bit later by the boot script.
		window.addEventListener('load', () => {
			setTimeout(() => {
				if (!enabled && looksLikeMisskey()) init();
			}, 1000);
		}, { once: true });
	}

	function looksLikeMisskey() {
		const meta = document.querySelector('meta[name="application-name"]');
		const name = (meta && meta.getAttribute('content')) || '';
		if (/misskey|sharkey|cherrypick/i.test(name)) return true;
		return document.getElementById('misskey_app') != null;
	}

	function init() {
		if (enabled) return;
		enabled = true;
		store = loadStore();
		installHistoryHooks();

		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		// Record the position synchronously right before a click / tap / swipe navigates away.
		document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				captureNow();
				flush();
			}
		});
		window.addEventListener('pagehide', () => {
			captureNow();
			flush();
		});

		new MutationObserver(scheduleCheck).observe(document.documentElement, { childList: true, subtree: true });

		const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
		const navType = nav ? nav.type : '';
		if ((navType === 'reload' && CONFIG.restoreOnReload) || (navType === 'back_forward' && CONFIG.restoreOnBack)) {
			armPending(navType, false);
		}

		window.__misskeyTimelineImprovement = {
			version: VERSION,
			config: CONFIG,
			get state() { return store; },
			get last() { return lastResult; },
			capture: captureNow,
		};
		log('enabled', { version: VERSION, key: cur.key, navType });
	}

	function installHistoryHooks() {
		const H = window.history;
		const origPush = H.pushState;
		const origReplace = H.replaceState;

		H.pushState = function pushState(state, unused, url) {
			guard(() => {
				// The DOM still shows the page we're leaving: record where we were.
				captureNow();
				cancelAll();
			});
			const key = newKey();
			const ret = origPush.call(this, tagState(state, key), unused, url);
			cur.key = key;
			cur.path = currentPath();
			return ret;
		};

		H.replaceState = function replaceState(state, unused, url) {
			// Misskey replaces the state with `{}` on popstate; keep our key on the entry.
			const key = keyOf(H.state) || cur.key || newKey();
			const ret = origReplace.call(this, tagState(state, key), unused, url);
			cur.key = key;
			cur.path = currentPath();
			return ret;
		};

		let key = keyOf(H.state);
		if (!key) {
			key = newKey();
			origReplace.call(H, tagState(H.state, key), '');
		}
		cur.key = key;
		cur.path = currentPath();
	}

	// ---------------------------------------------------------------------------------------
	// Events

	function onPopState(ev) {
		if (!enabled) return;
		guard(() => {
			// Still showing the page we're leaving (Misskey hasn't handled the event yet).
			const container = findContainer();
			captureNow();
			cancelAll();
			const oldPath = cur.path;
			cur.key = keyOf(ev.state);
			cur.path = currentPath();
			if (CONFIG.restoreOnBack) armPending('history', oldPath !== cur.path ? container : null);
		});
	}

	let captureTimer = 0;
	let lastCapture = 0;
	function onScroll() {
		if (!enabled || pending || restoring || captureTimer) return;
		const wait = Math.max(0, 200 - (Date.now() - lastCapture));
		captureTimer = setTimeout(() => {
			captureTimer = 0;
			lastCapture = Date.now();
			guard(captureNow);
		}, wait);
	}

	function onPointerDown(ev) {
		if (toastEl && toastEl.contains(ev.target)) return;
		guard(captureNow);
	}

	let checkTimer = 0;
	function scheduleCheck() {
		if (!enabled || checkTimer) return;
		checkTimer = setTimeout(() => {
			checkTimer = 0;
			guard(runChecks);
		}, 80);
	}

	function runChecks() {
		if (pending) {
			checkPending();
		} else if (!restoring) {
			checkNewList();
		}
	}

	function cancelAll() {
		pending = null;
		if (restoring) restoring.cancelled = true;
	}

	// ---------------------------------------------------------------------------------------
	// Capturing the position

	function captureNow() {
		if (!enabled || pending || restoring || !cur.key) return;
		const c = findContainer();
		if (!c) return;
		const anchors = visibleAnchors(c);
		if (anchors.length === 0) return;

		const root = listRoot(anchors);
		if (!seenLists.has(root)) {
			// A list we haven't looked at yet (e.g. right after a tab switch): it may need to be
			// restored rather than recorded at its fresh top position.
			checkNewList();
			if (pending || restoring) return;
		}
		const id = identityOf(c);
		if (!sameListIdentity(root, id)) return;

		const snap = takeSnapshot(c, anchors);
		const e = getEntry(cur.key, true);
		e.t = Date.now();
		e.tabs[id] = snap;
		e.last = id;
		scheduleSave();
	}

	function takeSnapshot(c, anchors) {
		const now = Date.now();
		const vTop = viewTop(c);
		const vBottom = viewBottom(c);
		const cTop = boxTop(c);

		// At the very top: just stay there, so new notes keep showing up as usual.
		if (anchors[0].getBoundingClientRect().top >= vTop - 2) return { top: true, st: Math.round(c.scrollTop), t: now };

		// First anchor whose bottom edge is below the visible top.
		let lo = 0;
		let hi = anchors.length - 1;
		let idx = anchors.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (anchors[mid].getBoundingClientRect().bottom > vTop + 1) {
				idx = mid;
				hi = mid - 1;
			} else {
				lo = mid + 1;
			}
		}

		// Prefer a note that starts inside the upper half of the view: its top edge is a more
		// stable reference than a note that is mostly scrolled away.
		let pick = idx;
		if (anchors[idx].getBoundingClientRect().top < vTop - 1 && idx + 1 < anchors.length) {
			if (anchors[idx + 1].getBoundingClientRect().top < vTop + (vBottom - vTop) / 2) pick = idx + 1;
		}

		const near = [];
		for (let i = pick + 1; i < anchors.length && near.length < 5; i++) {
			near.push([anchorId(anchors[i]), Math.round(anchors[i].getBoundingClientRect().top - cTop)]);
		}

		return {
			id: anchorId(anchors[pick]),
			off: Math.round(anchors[pick].getBoundingClientRect().top - cTop),
			near,
			chrono: isChronological(anchors),
			t: now,
		};
	}

	// ---------------------------------------------------------------------------------------
	// Deciding when to restore

	function armPending(reason, ignoreContainer) {
		const e = cur.key ? getEntry(cur.key, false) : null;
		if (!e || Object.keys(e.tabs).length === 0) return;
		const p = { key: cur.key, reason, since: Date.now(), ignore: ignoreContainer || null, seenAt: 0 };
		pending = p;
		setTimeout(() => {
			if (pending === p) pending = null;
		}, PENDING_TIMEOUT);
		scheduleCheck();
	}

	function checkPending() {
		const p = pending;
		if (Date.now() - p.since > PENDING_TIMEOUT) {
			pending = null;
			return;
		}
		const pollLater = () => setTimeout(scheduleCheck, 150);

		const c = findContainer();
		if (!c || c === p.ignore) return pollLater();
		const anchors = visibleAnchors(c);
		if (anchors.length === 0) return pollLater();

		const id = identityOf(c);
		const e = getEntry(p.key, false);
		const snap = e && e.tabs[id];
		if (!snap) {
			// The header might not be fully rendered yet; give it a moment before giving up.
			if (!p.seenAt) p.seenAt = Date.now();
			if (Date.now() - p.seenAt < NO_SNAPSHOT_GRACE) return pollLater();
			pending = null;
			registerList(c, listRoot(anchors), id, true);
			return;
		}

		pending = null;
		registerList(c, listRoot(anchors), id, true);
		restore(c, snap, p.reason);
	}

	/** Called when a list we haven't seen yet appears: a tab switch, a refresh, or a new page. */
	function checkNewList() {
		const c = findContainer();
		if (!c) return;
		const anchors = visibleAnchors(c);
		if (anchors.length === 0) return;
		const root = listRoot(anchors);
		if (seenLists.has(root)) return;

		const id = identityOf(c);
		const prev = registerList(c, root, id, true);
		// Same tab as before = the list was refreshed on purpose (pull to refresh, filter change).
		if (!CONFIG.restoreOnTabSwitch || !prev || prev === id) return;
		const e = getEntry(cur.key, false);
		const snap = e && e.tabs[id];
		if (snap && !snap.top) restore(c, snap, 'tab');
	}

	/** Remembers a list root; returns the identity the current entry showed before. */
	function registerList(c, root, id, updateLast) {
		seenLists.add(root);
		listIdentity.set(root, { id, mismatchSince: 0 });
		if (!cur.key) return null;
		const e = getEntry(cur.key, true);
		const prev = e.last;
		if (updateLast) e.last = id;
		return prev;
	}

	/**
	 * Whether the list still belongs to the tab it was first shown under. A short mismatch means
	 * the header already switched tabs while the old list is still on screen; a lasting one means
	 * the same list now lives under another identity (e.g. the URL was rewritten), so adopt it.
	 */
	function sameListIdentity(root, id) {
		const info = listIdentity.get(root);
		if (!info) return false;
		if (info.id === id) {
			info.mismatchSince = 0;
			return true;
		}
		if (!info.mismatchSince) info.mismatchSince = Date.now();
		if (Date.now() - info.mismatchSince < 1000) return false;
		info.id = id;
		info.mismatchSince = 0;
		return true;
	}

	// ---------------------------------------------------------------------------------------
	// Restoring

	async function restore(c, snap, reason) {
		const job = { cancelled: false };
		restoring = job;
		const stopWatching = watchUserInput(() => { job.cancelled = true; });
		let result = 'notfound';
		let pages = 0;
		let settledOnce = false;
		log('restore start', reason, snap);

		try {
			const limit = snap.chrono ? CONFIG.maxLoadPages : CONFIG.maxLoadPagesUnordered;
			const deadline = Date.now() + RESTORE_DEADLINE;
			for (;;) {
				if (job.cancelled || !c.isConnected) {
					result = 'cancelled';
					break;
				}
				if (snap.top) {
					await hold(c, job, () => (snap.st || 0) - c.scrollTop);
					result = 'restored';
					break;
				}
				let hit = locate(c, snap);
				if (hit && !hit.exact) {
					// Sharkey renders most notes asynchronously, so a freshly loaded page can be
					// half there. Only trust a fallback once the list has stopped changing.
					await waitStable(c, job);
					if (job.cancelled || !c.isConnected) continue;
					hit = locate(c, snap);
				}
				if (hit) {
					hideToast();
					await hold(c, job, () => (hit.el.isConnected ? hit.el.getBoundingClientRect().top - boxTop(c) - hit.off : null));
					result = hit.exact ? 'restored' : 'approximate';
					break;
				}
				if (pages >= limit || Date.now() > deadline) break;
				if (!settledOnce) {
					// Let the first page finish rendering before deciding to load more.
					settledOnce = true;
					await waitStable(c, job);
					continue;
				}

				const more = findLoadMore(c);
				if (more === 'end') break;
				const before = listSignature(c);
				if (more !== 'loading') {
					// Scroll just past the head so live updates go to the "new notes" queue
					// instead of being inserted above (which can push old notes out of the list).
					if (pages === 0) nudgePastHead(c);
					more.click();
					pages++;
					showProgressToast(pages, job);
				}
				const r = await waitForChange(c, job, before, 15000);
				if (r === 'timeout') break;
			}
		} catch (err) {
			log('restore failed', err);
		} finally {
			stopWatching();
			if (restoring === job) restoring = null;
		}

		if (result === 'notfound' && !job.cancelled) {
			flashToast(t('notFound'));
		} else {
			hideToast();
		}
		lastResult = { result, reason, pages, at: Date.now() };
		log('restore end', lastResult);
		if (result === 'restored' || result === 'approximate') captureNow();
		window.dispatchEvent(new CustomEvent(NS + ':restore', { detail: lastResult }));
	}

	function locate(c, snap) {
		const query = (id) => {
			const el = c.querySelector(ANCHOR + '[data-scroll-anchor="' + cssEscape(id) + '"]');
			return el && el.getClientRects().length > 0 ? el : null;
		};

		let el = query(snap.id);
		if (el) return { el, off: snap.off, exact: true };

		// The note itself may have been deleted: use the ones that were right below it.
		for (const [id, off] of snap.near || []) {
			el = query(id);
			if (el) {
				log('locate: using a nearby note', id);
				return { el, off, exact: false };
			}
		}

		// Time-ordered list and we're already past it: settle on the next older note.
		if (snap.chrono) {
			const anchors = visibleAnchors(c);
			const last = anchors[anchors.length - 1];
			if (last && isOlder(anchorId(last), snap.id)) {
				const older = anchors.find((a) => isOlder(anchorId(a), snap.id));
				if (older) {
					log('locate: passed it, using the next older note', anchorId(older));
					return { el: older, off: snap.off, exact: false };
				}
			}
		}
		return null;
	}

	/**
	 * Keeps the position for a moment while the layout settles (images, lazily rendered notes,
	 * Misskey's own scroll restoration...). `delta()` returns how far to scroll, or null to stop.
	 */
	function hold(c, job, delta) {
		return new Promise((resolve) => {
			const start = Date.now();
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				resolve();
			};
			const apply = () => {
				if (!c.isConnected) return false;
				const d = delta();
				if (d == null) return false;
				if (Math.abs(d) >= 1) c.scrollTop += d;
				return true;
			};
			const tick = () => {
				if (done) return;
				if (job.cancelled || !apply() || Date.now() - start > SETTLE_MS) {
					finish();
					return;
				}
				requestAnimationFrame(tick);
			};
			apply();
			requestAnimationFrame(tick);
			// requestAnimationFrame doesn't run in background tabs.
			setTimeout(finish, SETTLE_MS + 500);
		});
	}

	/**
	 * Finds the "load more" button right after the list.
	 * Returns the button, 'loading' while a page is being fetched, or 'end' when there's no more.
	 */
	function findLoadMore(c) {
		const anchors = visibleAnchors(c);
		if (anchors.length === 0) return 'end';
		let node = listRoot(anchors);
		for (let depth = 0; node && node !== c && depth < 4; depth++, node = node.parentElement) {
			if (!node.nextElementSibling) continue;
			// Still inside the list (more items follow, possibly not rendered yet): go up.
			if (hasSimilarSibling(node) || hasAnchorAfter(node)) continue;
			let sawContent = false;
			for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
				if (sib.offsetHeight === 0 && sib.getClientRects().length === 0) continue;
				const btn = sib.tagName === 'BUTTON' ? sib : sib.querySelector('button');
				if (btn && btn.getClientRects().length > 0 && !btn.closest(ANCHOR)) {
					return btn.disabled || btn.getAttribute('aria-busy') === 'true' ? 'loading' : btn;
				}
				if (sib.offsetHeight > 0) sawContent = true; // e.g. the loading spinner
			}
			return sawContent ? 'loading' : 'end';
		}
		return 'end';
	}

	function hasAnchorAfter(node) {
		for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
			if (sib.matches(ANCHOR) || sib.querySelector(ANCHOR)) return true;
		}
		return false;
	}

	async function waitForChange(c, job, before, timeout) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			await sleep(120);
			if (job.cancelled || !c.isConnected) return 'cancelled';
			if (listSignature(c) !== before) {
				await waitStable(c, job);
				return 'changed';
			}
			const more = findLoadMore(c);
			if (more === 'end') return 'end';
			// The button is still there and nothing changed: the click was ignored, try again.
			if (more !== 'loading' && Date.now() - start > 2500) return 'stalled';
		}
		return 'timeout';
	}

	function listSignature(c) {
		const anchors = visibleAnchors(c);
		return anchors.length + ':' + (anchors.length ? anchorId(anchors[anchors.length - 1]) : '');
	}

	/** Resolves once no list item has been added or removed for `quiet` ms (or after `max` ms). */
	async function waitStable(c, job, quiet = 300, max = 4000) {
		const start = Date.now();
		let count = c.querySelectorAll(ANCHOR).length;
		let since = Date.now();
		while (Date.now() - start < max) {
			await sleep(50);
			if (job.cancelled || !c.isConnected) return;
			const now = c.querySelectorAll(ANCHOR).length;
			if (now !== count) {
				count = now;
				since = Date.now();
			} else if (Date.now() - since >= quiet) {
				return;
			}
		}
	}

	function nudgePastHead(c) {
		const anchors = visibleAnchors(c);
		if (anchors.length === 0) return;
		const delta = Math.max(anchors[0].getBoundingClientRect().top - viewTop(c) + 24, 32 - c.scrollTop);
		if (delta > 0) c.scrollTop += delta;
	}

	function watchUserInput(onInput) {
		const handler = (ev) => {
			if (toastEl && ev.target instanceof Node && toastEl.contains(ev.target)) return;
			if (ev.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return;
			onInput();
		};
		const types = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
		for (const type of types) window.addEventListener(type, handler, { capture: true, passive: true });
		return () => {
			for (const type of types) window.removeEventListener(type, handler, { capture: true });
		};
	}

	// ---------------------------------------------------------------------------------------
	// DOM helpers

	/** The main page scroll container that holds a list (the largest visible page). */
	function findContainer() {
		const pages = document.querySelectorAll('._pageScrollable');
		if (pages.length > 0) {
			let best = null;
			let bestArea = 0;
			for (const el of pages) {
				const area = visibleArea(el.getBoundingClientRect());
				if (area > bestArea) {
					best = el;
					bestArea = area;
				}
			}
			return best && best.querySelector(ANCHOR) ? best : null;
		}
		// Layouts without `._pageScrollable`: use the scroll parent of the first list item.
		const first = document.querySelector(ANCHOR);
		return first ? scrollParent(first) : null;
	}

	function visibleArea(r) {
		const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
		const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
		return w > 0 && h > 0 ? w * h : 0;
	}

	function scrollParent(el) {
		for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
			const oy = getComputedStyle(p).overflowY;
			if (oy === 'auto' || oy === 'scroll') return p;
		}
		return document.scrollingElement || document.documentElement;
	}

	/** Top-level list items (not nested inside another item) that are rendered. */
	function visibleAnchors(c) {
		const out = [];
		for (const a of c.querySelectorAll(ANCHOR)) {
			const outer = a.parentElement && a.parentElement.closest(ANCHOR);
			if (outer && c.contains(outer)) continue;
			if (a.getClientRects().length === 0) continue;
			out.push(a);
		}
		return out;
	}

	function anchorId(el) {
		return el.getAttribute('data-scroll-anchor') || '';
	}

	/** The element that holds the whole list. */
	function listRoot(anchors) {
		const first = anchors[0];
		const last = anchors[anchors.length - 1];
		if (first === last) {
			// Only one item rendered so far. If it sits in a per-item wrapper (like Sharkey's
			// MkTimeline), the list is the wrapper's parent.
			const parent = first.parentElement;
			if (!parent) return first;
			if (parent.childElementCount === 1 && parent.parentElement && hasSimilarSibling(parent)) return parent.parentElement;
			return parent;
		}
		const ancestors = new Set();
		for (let n = first.parentElement; n; n = n.parentElement) ancestors.add(n);
		for (let n = last.parentElement; n; n = n.parentElement) {
			if (ancestors.has(n)) return n;
		}
		return first.parentElement || first;
	}

	/** Whether a sibling looks like another item of the same list (same tag and classes). */
	function hasSimilarSibling(el) {
		if (!el.className) return false;
		for (const s of el.parentElement ? el.parentElement.children : []) {
			if (s !== el && s.tagName === el.tagName && s.className === el.className) return true;
		}
		return false;
	}

	function boxTop(c) {
		return c === document.scrollingElement || c === document.documentElement ? 0 : c.getBoundingClientRect().top;
	}

	function viewBottom(c) {
		return c === document.scrollingElement || c === document.documentElement ? window.innerHeight : c.getBoundingClientRect().bottom;
	}

	/** Top of the visible area, below the sticky page header. */
	function viewTop(c) {
		const top = boxTop(c);
		const header = stickyHeader(c);
		if (header) {
			const r = header.getBoundingClientRect();
			if (r.height > 0 && r.bottom > top && r.bottom < top + c.clientHeight / 2) return r.bottom;
		}
		return top;
	}

	function stickyHeader(c) {
		const body = c.querySelector('[data-sticky-container-header-height]');
		return body ? body.previousElementSibling : null;
	}

	/**
	 * Which list is shown: the page path plus the selected header tab
	 * (Home / Local / Social / Global / lists... on the timeline page).
	 */
	function identityOf(c) {
		return cur.path + '|' + activeTab(c);
	}

	function activeTab(c) {
		const header = stickyHeader(c);
		if (!header) return '';
		const groups = new Set();
		for (const b of header.querySelectorAll('button')) {
			if (b.parentElement) groups.add(b.parentElement);
		}
		for (const g of groups) {
			const buttons = Array.from(g.children).filter((e) => e.tagName === 'BUTTON');
			if (buttons.length < 2) continue;
			let active = buttons.find((b) => b.getAttribute('aria-selected') === 'true' || b.hasAttribute('aria-current'));
			if (!active) {
				// The selected tab is the only one with an extra (hashed) "active" class.
				const counts = buttons.map((b) => b.classList.length);
				const max = Math.max(...counts);
				if (max > Math.min(...counts) && counts.indexOf(max) === counts.lastIndexOf(max)) {
					active = buttons[counts.indexOf(max)];
				}
			}
			if (active) {
				const icon = active.querySelector('i');
				const iconClass = icon ? icon.className : '';
				const text = (active.textContent || '').trim().slice(0, 40);
				return buttons.indexOf(active) + ':' + iconClass + ':' + text;
			}
		}
		return '';
	}

	function isChronological(anchors) {
		let compared = 0;
		let inversions = 0;
		let prev = null;
		for (const a of anchors) {
			const id = anchorId(a);
			if (prev !== null && prev.length === id.length) {
				compared++;
				if (id > prev) inversions++;
			}
			prev = id;
		}
		return compared >= 2 && inversions <= Math.max(1, compared * 0.05);
	}

	/** Misskey ids (aid, aidx, meid, ulid, objectid) sort by creation time as plain strings. */
	function isOlder(id, than) {
		return id.length === than.length && id < than;
	}

	// ---------------------------------------------------------------------------------------
	// Toast

	let toastEl = null;
	let toastText = null;
	let toastButton = null;
	let toastHideTimer = 0;

	function ensureToast() {
		if (toastEl && toastEl.isConnected) return toastEl;
		if (!document.getElementById(NS + '-style')) {
			const style = document.createElement('style');
			style.id = NS + '-style';
			style.textContent = TOAST_CSS;
			(document.head || document.documentElement).appendChild(style);
		}
		toastEl = document.createElement('div');
		toastEl.className = 'mti-toast';
		toastEl.setAttribute('role', 'status');
		toastEl.setAttribute('aria-live', 'polite');
		toastEl.hidden = true;
		const spinner = document.createElement('span');
		spinner.className = 'mti-spinner';
		spinner.setAttribute('aria-hidden', 'true');
		toastText = document.createElement('span');
		toastText.className = 'mti-text';
		toastButton = document.createElement('button');
		toastButton.type = 'button';
		toastButton.className = 'mti-cancel';
		toastEl.append(spinner, toastText, toastButton);
		document.body.appendChild(toastEl);
		return toastEl;
	}

	function showProgressToast(pages, job) {
		if (!CONFIG.showToast) return;
		ensureToast();
		clearTimeout(toastHideTimer);
		toastEl.classList.remove('mti-done');
		toastText.textContent = t('restoring') + ' ' + t('pages', pages);
		toastButton.textContent = t('cancel');
		toastButton.hidden = false;
		toastButton.onclick = () => {
			job.cancelled = true;
			hideToast();
		};
		toastEl.hidden = false;
	}

	function flashToast(text) {
		if (!CONFIG.showToast) return;
		ensureToast();
		clearTimeout(toastHideTimer);
		toastEl.classList.add('mti-done');
		toastText.textContent = text;
		toastButton.hidden = true;
		toastEl.hidden = false;
		toastHideTimer = setTimeout(hideToast, 2500);
	}

	function hideToast() {
		clearTimeout(toastHideTimer);
		if (toastEl) toastEl.hidden = true;
	}

	const TOAST_CSS = `
.mti-toast {
	position: fixed;
	left: 50%;
	bottom: calc(80px + env(safe-area-inset-bottom, 0px));
	transform: translateX(-50%);
	z-index: 2147483000;
	display: flex;
	align-items: center;
	gap: 10px;
	max-width: calc(100vw - 32px);
	box-sizing: border-box;
	padding: 8px 8px 8px 14px;
	border-radius: 999px;
	border: solid 0.5px var(--MI_THEME-divider, var(--divider, rgba(127, 127, 127, 0.3)));
	background: var(--MI_THEME-panel, var(--panel, #2a2a2e));
	color: var(--MI_THEME-fg, var(--fg, #e6e6e6));
	box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
	font-size: 13px;
	line-height: 1.4;
}
.mti-toast[hidden] { display: none; }
.mti-toast.mti-done { padding: 8px 16px; }
.mti-toast.mti-done .mti-spinner { display: none; }
.mti-spinner {
	flex: none;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	border: 2px solid currentColor;
	border-right-color: transparent;
	opacity: 0.7;
	animation: mti-spin 0.8s linear infinite;
}
.mti-cancel {
	flex: none;
	appearance: none;
	border: 0;
	border-radius: 999px;
	padding: 4px 12px;
	background: var(--MI_THEME-accent, var(--accent, #86b300));
	color: var(--MI_THEME-fgOnAccent, var(--fgOnAccent, #fff));
	font: inherit;
	cursor: pointer;
}
.mti-cancel[hidden] { display: none; }
@keyframes mti-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mti-spinner { animation: none; } }
`;

	const MESSAGES = {
		en: {
			restoring: 'Returning to where you left off…',
			pages: (n) => `(${n} ${n === 1 ? 'page' : 'pages'} loaded)`,
			cancel: 'Cancel',
			notFound: 'Couldn’t find where you left off',
		},
		ja: {
			restoring: '前回の位置に戻っています…',
			pages: (n) => `（${n} ページ読み込み済み）`,
			cancel: 'キャンセル',
			notFound: '前回の位置が見つかりませんでした',
		},
		'zh-TW': {
			restoring: '正在回到上次的位置…',
			pages: (n) => `（已載入 ${n} 頁）`,
			cancel: '取消',
			notFound: '找不到上次的位置',
		},
		'zh-CN': {
			restoring: '正在回到上次的位置…',
			pages: (n) => `（已加载 ${n} 页）`,
			cancel: '取消',
			notFound: '找不到上次的位置',
		},
	};

	function t(key, arg) {
		const ls = safeLocalStorage();
		const lang = ((ls && ls.getItem('lang')) || navigator.language || 'en').toLowerCase();
		const table = /^zh[-_](tw|hk|mo|hant)/.test(lang) ? MESSAGES['zh-TW']
			: lang.startsWith('zh') ? MESSAGES['zh-CN']
				: lang.startsWith('ja') ? MESSAGES.ja
					: MESSAGES.en;
		const msg = table[key];
		return typeof msg === 'function' ? msg(arg) : msg;
	}

	// ---------------------------------------------------------------------------------------
	// Storage

	function loadStore() {
		try {
			const s = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
			if (s && s.v === 1 && s.entries && typeof s.entries === 'object') return s;
		} catch { /* ignore */ }
		return { v: 1, entries: {} };
	}

	let saveTimer = 0;
	function scheduleSave() {
		if (!saveTimer) saveTimer = setTimeout(flush, 300);
	}

	function flush() {
		clearTimeout(saveTimer);
		saveTimer = 0;
		const keys = Object.keys(store.entries);
		if (keys.length > MAX_ENTRIES) {
			keys.sort((a, b) => store.entries[a].t - store.entries[b].t);
			for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete store.entries[k];
		}
		for (const e of Object.values(store.entries)) {
			const ids = Object.keys(e.tabs);
			if (ids.length > MAX_TABS_PER_ENTRY) {
				ids.sort((a, b) => e.tabs[a].t - e.tabs[b].t);
				for (const id of ids.slice(0, ids.length - MAX_TABS_PER_ENTRY)) delete e.tabs[id];
			}
		}
		try {
			sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
		} catch { /* quota or private mode */ }
	}

	function getEntry(key, create) {
		let e = store.entries[key];
		if (!e && create) e = store.entries[key] = { t: Date.now(), tabs: {}, last: null };
		return e || null;
	}

	// ---------------------------------------------------------------------------------------
	// Utilities

	function currentPath() {
		return location.pathname + location.search;
	}

	function newKey() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	function keyOf(state) {
		return state && typeof state === 'object' && typeof state[HISTORY_KEY] === 'string' ? state[HISTORY_KEY] : null;
	}

	function tagState(state, key) {
		if (state == null) return { [HISTORY_KEY]: key };
		if (typeof state === 'object' && Object.getPrototypeOf(state) === Object.prototype) {
			return Object.assign({}, state, { [HISTORY_KEY]: key });
		}
		return state;
	}

	function cssEscape(s) {
		return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
	}

	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function safeLocalStorage() {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	}

	function readJson(storage, key) {
		try {
			const v = storage && JSON.parse(storage.getItem(key) || 'null');
			return v && typeof v === 'object' ? v : {};
		} catch {
			return {};
		}
	}

	function guard(fn) {
		try {
			fn();
		} catch (err) {
			log('error', err);
		}
	}

	function log(...args) {
		if (CONFIG.debug) console.debug('[' + NS + ']', ...args);
	}
})();
