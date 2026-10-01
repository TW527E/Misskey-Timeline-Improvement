// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const USERSCRIPT = fs.readFileSync(path.join(__dirname, '..', 'misskey-timeline-improvement.user.js'), 'utf8');
const MOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'mock-misskey.html'), 'utf8');
const ORIGIN = 'http://misskey.test';

/** Opens the mock client with the userscript injected like `@run-at document-start`. */
async function open(page, options = {}, html = MOCK) {
	await page.route(ORIGIN + '/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
	await page.addInitScript((o) => { window.MOCK_OPTIONS = o; }, options);
	await page.addInitScript({ content: USERSCRIPT });
	await page.goto(ORIGIN + '/');
	if (html === MOCK) await page.waitForSelector('[data-scroll-anchor]');
}

/** Scrolls (loading more as needed) so that the index-th note sits `offset` px below the container top. */
async function scrollToNote(page, index, offset = 137) {
	const res = await page.evaluate(async ({ index, offset }) => {
		const c = /** @type {HTMLElement} */ (document.querySelector('._pageScrollable'));
		// top-level list items only (thread units repeat their ids inside)
		const anchors = () => c.querySelectorAll('.unit > [data-scroll-anchor]');
		for (let i = 0; i < 200 && anchors().length <= index + 3; i++) {
			c.scrollTop = c.scrollHeight;
			const more = c.querySelector('.moreWrap button');
			if (more) more.click();
			await new Promise((r) => setTimeout(r, 100));
		}
		// let asynchronously rendered notes attach
		await new Promise((r) => setTimeout(r, 300));
		const a = anchors()[index];
		c.scrollTop += a.getBoundingClientRect().top - c.getBoundingClientRect().top - offset;
		await new Promise((r) => setTimeout(r, 50));
		return {
			id: /** @type {string} */ (a.getAttribute('data-scroll-anchor')),
			top: a.getBoundingClientRect().top - c.getBoundingClientRect().top,
		};
	}, { index, offset });
	// let the scroll-based capture run
	await page.waitForTimeout(500);
	return res;
}

async function topOf(page, id) {
	return page.evaluate((id) => {
		const c = document.querySelector('._pageScrollable');
		const a = c && c.querySelector(`[data-scroll-anchor="${id}"]`);
		return a ? a.getBoundingClientRect().top - c.getBoundingClientRect().top : null;
	}, id);
}

async function markTime(page) {
	await page.evaluate(() => { window.__mtiSince = Date.now(); });
}

/** Waits for the userscript to report a finished restore (after markTime). */
async function waitForRestore(page) {
	const handle = await page.waitForFunction(() => {
		const api = window.__misskeyTimelineImprovement;
		const last = api && api.last;
		return last && last.at > (window.__mtiSince || 0) ? last : null;
	}, null, { timeout: 30000 });
	return handle.jsonValue();
}

async function openNote(page, id) {
	await page.click(`[data-scroll-anchor="${id}"] a`);
	await page.waitForSelector('.notePage');
}

async function expectAt(page, id, top) {
	const now = await topOf(page, id);
	expect(now, `note ${id} should be in the list`).not.toBeNull();
	expect(Math.abs(/** @type {number} */ (now) - top), `note ${id} at ${now}px, expected ${top}px`).toBeLessThan(2);
}

test('returns to the exact spot after going back, even when the timeline was rebuilt', async ({ page }) => {
	await open(page, { cache: false });
	const before = await scrollToNote(page, 60);
	await openNote(page, before.id);
	await markTime(page);
	await page.goBack();
	const result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	expect(result.pages).toBeGreaterThan(0);
	await expectAt(page, before.id, before.top);
});

test('fixes the imprecise restore when the page cache still holds the timeline', async ({ page }) => {
	await open(page, { cache: true, nativeRestore: true });
	const before = await scrollToNote(page, 25, 300);
	// give Sharkey's (throttled) scroll keeper time to record its own anchor
	await page.waitForTimeout(1100);
	await openNote(page, before.id);
	await markTime(page);
	await page.goBack();
	const result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	expect(result.pages).toBe(0);
	// Sharkey's keeper re-centers a note 100 ms after activation; make sure we end up exact anyway
	await page.waitForTimeout(300);
	await expectAt(page, before.id, before.top);
});

test('keeps the spot when new notes arrived while you were away', async ({ page }) => {
	await open(page, { cache: false });
	const before = await scrollToNote(page, 45);
	await openNote(page, before.id);
	await page.evaluate(() => window.mock.stream('home', 7));
	await markTime(page);
	await page.goBack();
	const result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	await expectAt(page, before.id, before.top);
});

test('returns to the spot after a reload', async ({ page }) => {
	await open(page, { cache: false });
	const before = await scrollToNote(page, 40);
	await page.reload();
	await page.waitForSelector('[data-scroll-anchor]');
	const result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	expect(result.reason).toBe('reload');
	await expectAt(page, before.id, before.top);
});

test('each history entry keeps its own position', async ({ page }) => {
	await open(page, { cache: false });
	const first = await scrollToNote(page, 30);
	await openNote(page, first.id);
	// open the timeline again as a new page (e.g. via the Home button)
	await page.evaluate(() => window.mock.router.push('/'));
	await page.waitForSelector('[data-scroll-anchor]');
	const second = await scrollToNote(page, 70);
	await openNote(page, second.id);

	await markTime(page);
	await page.goBack();
	expect((await waitForRestore(page)).result).toBe('restored');
	await expectAt(page, second.id, second.top);

	await page.goBack();
	await page.waitForSelector('.notePage');
	await markTime(page);
	await page.goBack();
	expect((await waitForRestore(page)).result).toBe('restored');
	await expectAt(page, first.id, first.top);
});

test('each timeline tab keeps its own position', async ({ page }) => {
	await open(page, { cache: true });
	const home = await scrollToNote(page, 30);

	await page.click('.tab:has-text("local")');
	await page.waitForSelector('[data-scroll-anchor$="l0"]');
	const local = await scrollToNote(page, 12, 200);

	await markTime(page);
	await page.click('.tab:has-text("home")');
	await page.waitForSelector('[data-scroll-anchor$="h0"]');
	let result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	expect(result.reason).toBe('tab');
	await expectAt(page, home.id, home.top);

	await markTime(page);
	await page.click('.tab:has-text("local")');
	await page.waitForSelector('[data-scroll-anchor$="l0"]');
	result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	await expectAt(page, local.id, local.top);
});

test('does not undo a deliberate refresh of the same tab', async ({ page }) => {
	await open(page, { cache: true });
	await scrollToNote(page, 30);
	await page.evaluate(() => window.mock.page.timeline.reload());
	await page.waitForSelector('[data-scroll-anchor]');
	await page.waitForTimeout(1500);
	expect(await page.evaluate(() => window.__misskeyTimelineImprovement.last)).toBeNull();
	const count = await page.locator('.unit > [data-scroll-anchor]').count();
	expect(count).toBeLessThanOrEqual(10 + 30); // no extra pages were loaded
});

test('stays at the top (showing new notes) when you left from the top', async ({ page }) => {
	await open(page, { cache: false });
	const firstId = await page.getAttribute('[data-scroll-anchor]', 'data-scroll-anchor');
	await page.waitForTimeout(400);
	await openNote(page, /** @type {string} */ (firstId));
	await page.evaluate(() => window.mock.stream('home', 3));
	await markTime(page);
	await page.goBack();
	const result = await waitForRestore(page);
	expect(result.result).toBe('restored');
	expect(result.pages).toBe(0);
	expect(await page.evaluate(() => document.querySelector('._pageScrollable').scrollTop)).toBe(0);
	await expect(page.locator('[data-scroll-anchor]').first()).toHaveText('home new 2');
});

test('scrolling while it loads cancels the restore', async ({ page }) => {
	await open(page, { cache: false, latency: 700, infiniteScroll: false });
	const before = await scrollToNote(page, 150);
	await openNote(page, before.id);
	await markTime(page);
	await page.goBack();
	await page.waitForSelector('.mti-toast:not([hidden])');
	await page.mouse.move(500, 400);
	await page.mouse.wheel(0, 200);
	const result = await waitForRestore(page);
	expect(result.result).toBe('cancelled');
	await expect(page.locator('.mti-toast')).toBeHidden();
});

test('the cancel button stops the restore', async ({ page }) => {
	await open(page, { cache: false, latency: 700, infiniteScroll: false });
	const before = await scrollToNote(page, 150);
	await openNote(page, before.id);
	await markTime(page);
	await page.goBack();
	await page.click('.mti-toast .mti-cancel');
	const result = await waitForRestore(page);
	expect(result.result).toBe('cancelled');
	await expect(page.locator('.mti-toast')).toBeHidden();
});

test('falls back to the next note when the note you left at was deleted', async ({ page }) => {
	await open(page, { cache: false });
	const before = await scrollToNote(page, 50);
	const next = await page.evaluate((id) => {
		const c = document.querySelector('._pageScrollable');
		const a = c.querySelector(`[data-scroll-anchor="${id}"]`);
		const n = a.parentElement.nextElementSibling.querySelector('.unit > [data-scroll-anchor]') || a.parentElement.nextElementSibling.firstElementChild;
		return { id: n.getAttribute('data-scroll-anchor'), top: n.getBoundingClientRect().top - c.getBoundingClientRect().top };
	}, before.id);
	await openNote(page, before.id);
	await page.evaluate((id) => window.mock.deleteNote(id), before.id);
	await markTime(page);
	await page.goBack();
	const result = await waitForRestore(page);
	expect(result.result).toBe('approximate');
	await expectAt(page, next.id, next.top);
});

test('gives up quickly on feeds that are not ordered by time', async ({ page }) => {
	await open(page, { cache: false });
	await page.click('.tab:has-text("reco")');
	await page.waitForSelector('[data-scroll-anchor*="r"]');
	await page.waitForTimeout(300);
	const before = await scrollToNote(page, 20);
	await openNote(page, before.id);
	await page.evaluate(() => window.mock.resetApiCalls());
	await markTime(page);
	await page.goBack();
	const result = await waitForRestore(page);
	expect(result.result).toBe('notfound');
	expect(result.pages).toBeLessThanOrEqual(5);
	expect(await page.evaluate(() => window.mock.apiCalls.length)).toBeLessThanOrEqual(1 + 5 + 1);
	await expect(page.locator('.mti-toast')).toBeVisible();
	await expect(page.locator('.mti-toast')).toBeHidden({ timeout: 5000 });
});

test('does nothing on sites that are not Misskey', async ({ page }) => {
	await open(page, {}, '<!DOCTYPE html><html><head><title>Other site</title></head><body><p>hello</p></body></html>');
	await page.waitForTimeout(1500);
	expect(await page.evaluate(() => typeof window.__misskeyTimelineImprovement)).toBe('undefined');
	expect(await page.evaluate(() => history.pushState.toString())).toContain('[native code]');
});
