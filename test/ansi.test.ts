import { test } from "node:test";
import assert from "node:assert/strict";
import { charWidth, stripAnsi, truncateToWidth, visibleWidth } from "../src/ansi.ts";

test("visibleWidth counts plain cells", () => {
	assert.equal(visibleWidth("hello"), 5);
	assert.equal(visibleWidth(""), 0);
	assert.equal(visibleWidth("▓▓░"), 3);
});

test("visibleWidth ignores ANSI escape sequences", () => {
	const styled = "\x1b[38;5;34mhello\x1b[39m";
	assert.equal(visibleWidth(styled), 5);
	assert.equal(stripAnsi(styled), "hello");
});

test("charWidth treats wide characters as 2 cells", () => {
	assert.equal(charWidth("a"), 1);
	assert.equal(charWidth("中"), 2);
	assert.equal(charWidth("🎉"), 2);
	assert.equal(charWidth("\t"), 0);
});

test("truncateToWidth leaves short text untouched", () => {
	const text = "ab";
	assert.equal(truncateToWidth(text, 10), "ab");
	assert.equal(truncateToWidth(text, 2), "ab");
});

test("truncateToWidth appends ellipsis when truncating", () => {
	const text = "abcdefgh";
	assert.equal(truncateToWidth(text, 5), "abcd…");
	assert.equal(visibleWidth("abcd…"), 5);
});

test("truncateToWidth respects the width budget with ANSI codes", () => {
	const styled = "\x1b[31mabcdefgh\x1b[39m";
	const result = truncateToWidth(styled, 5);
	assert.equal(visibleWidth(result), 5);
	assert.ok(result.startsWith("\x1b[31m"));
	assert.equal(stripAnsi(result), "abcd…");
});

test("truncateToWidth keeps ANSI escapes intact when no truncation happens", () => {
	const styled = "\x1b[31mab\x1b[39m";
	assert.equal(truncateToWidth(styled, 10), styled);
});

test("truncateToWidth never exceeds the width (mix of wide and narrow)", () => {
	const text = "中a中b中c";
	for (let width = 1; width <= 10; width++) {
		const result = truncateToWidth(text, width);
		const w = visibleWidth(result);
		assert.ok(w <= width, `width=${width} result=${JSON.stringify(result)} w=${w}`);
	}
});

test("truncateToWidth with a custom ellipsis", () => {
	assert.equal(truncateToWidth("abcdef", 4, ".."), "ab..");
});

test("truncateToWidth handles zero width", () => {
	assert.equal(truncateToWidth("abc", 0), "");
});
test("gauge glyphs and widget symbols resolve to single cells", () => {
	for (const ch of ["⟳", "─", "│", "═", "·", "░", "█", "…"]) {
		assert.equal(charWidth(ch), 1, JSON.stringify(ch));
	}
	assert.equal(visibleWidth("═══│12%──────"), 13);
	assert.equal(visibleWidth(" ⟳3h47m"), 7);
});
