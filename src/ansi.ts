/**
 * Minimal ANSI-aware string utilities for widget rendering.
 *
 * Deliberately self-contained (zero dependencies): the TUI appends a full SGR
 * reset at the end of every rendered line, so truncation only needs to keep
 * escape sequences intact while counting display cells.
 */

/** Matches ANSI escape sequences (CSI/OSC families) including SGR color codes. */
export const ANSI_ESCAPE_RE =
	/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE_RE, "");
}

/** Approximate terminal display width in cells (0 for control/combining, 2 for wide CJK/emoji). */
export function charWidth(ch: string): number {
	const code = ch.codePointAt(0);
	if (code === undefined) return 0;
	if (code === 0) return 0;
	// Control characters
	if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
	// Combining marks
	if ((code >= 0x0300 && code <= 0x036f) || (code >= 0x1ab0 && code <= 0x1aff) || (code >= 0x20d0 && code <= 0x20ff)) {
		return 0;
	}
	// Wide / fullwidth ranges (East Asian Width = W/F)
	if (
		(code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
		(code >= 0x2e80 && code <= 0x303e) || // CJK Radicals..CJK Symbols
		(code >= 0x3041 && code <= 0x33ff) || // Hiragana..CJK Compatibility
		(code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ideographs Ext A
		(code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
		(code >= 0xa000 && code <= 0xa4cf) || // Yi
		(code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
		(code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
		(code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
		(code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
		(code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
		(code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
		(code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
		(code >= 0x1f300 && code <= 0x1f64f) || // Emoji
		(code >= 0x1f900 && code <= 0x1f9ff) ||
		(code >= 0x20000 && code <= 0x2fffd) // CJK Ext B+
	) {
		return 2;
	}
	return 1;
}

/** Number of terminal cells `text` occupies (ANSI sequences contribute zero). */
export function visibleWidth(text: string): number {
	let width = 0;
	let index = 0;
	ANSI_ESCAPE_RE.lastIndex = 0;
	while (index < text.length) {
		ANSI_ESCAPE_RE.lastIndex = index;
		const match = ANSI_ESCAPE_RE.exec(text);
		if (match && match.index === index) {
			index += match[0].length;
			continue;
		}
		const ch = String.fromCodePoint(text.codePointAt(index)!);
		width += charWidth(ch);
		index += ch.length;
	}
	return width;
}

/**
 * Truncate `text` to at most `width` cells, preserving any ANSI sequences and
 * appending `ellipsis` ("…") when truncation occurred. Lines must not exceed
 * the widget width — call this on every rendered line.
 */
export function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= width) {
		// Only the ellipsis fits — emit it alone, honoring the budget.
		return ellipsis.slice(0, width);
	}
	const limit = width - ellipsisWidth;
	let out = "";
	let cells = 0;
	let index = 0;
	let truncated = false;
	while (index < text.length) {
		ANSI_ESCAPE_RE.lastIndex = index;
		const match = ANSI_ESCAPE_RE.exec(text);
		if (match && match.index === index) {
			out += match[0];
			index += match[0].length;
			continue;
		}
		const ch = String.fromCodePoint(text.codePointAt(index)!);
		const w = charWidth(ch);
		if (cells + w > limit) {
			truncated = true;
			break;
		}
		out += ch;
		cells += w;
		index += ch.length;
	}
	if (truncated || index < text.length) return out + ellipsis;
	return out;
}