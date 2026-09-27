import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, parseGoUsageConfig } from "../src/config.ts";

test("missing/invalid input falls back to defaults", () => {
	for (const garbage of [undefined, null, 42, "nope", [], { not: "a config" }]) {
		assert.deepEqual(parseGoUsageConfig(garbage), DEFAULT_CONFIG, JSON.stringify(garbage));
	}
});

test("valid layouts and countdown toggle", () => {
	const expected = (patch: Record<string, unknown>) => ({ ...DEFAULT_CONFIG, ...patch });
	assert.deepEqual(parseGoUsageConfig({ layout: "single" }), expected({ layout: "single" }));
	assert.deepEqual(parseGoUsageConfig({ layout: "multi" }), expected({ layout: "multi" }));
	assert.deepEqual(
		parseGoUsageConfig({ showCountdown: false }),
		expected({ showCountdown: false }),
	);
	assert.deepEqual(
		parseGoUsageConfig({ layout: "multi", showCountdown: false }),
		expected({ layout: "multi", showCountdown: false }),
	);
});

test("invalid field values default per-field, unknown fields ignored", () => {
	const expected = (patch: Record<string, unknown>) => ({ ...DEFAULT_CONFIG, ...patch });
	assert.deepEqual(parseGoUsageConfig({ layout: "wide" }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ layout: 42 }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ showCountdown: "yes" }), DEFAULT_CONFIG);
	assert.deepEqual(
		parseGoUsageConfig({ layout: "single", showCountdown: 1 }),
		expected({ layout: "single" }),
	);
	assert.deepEqual(
		parseGoUsageConfig({ layout: "multi", extra: true }),
		expected({ layout: "multi" }),
	);
});

test("placement option: valid values kept, invalid default", () => {
	assert.equal(parseGoUsageConfig({ placement: "sidebar" }).placement, "sidebar");
	assert.equal(parseGoUsageConfig({ placement: "both" }).placement, "both");
	assert.equal(parseGoUsageConfig({ placement: "promptFooter" }).placement, "promptFooter");
	assert.equal(parseGoUsageConfig({ placement: "never" }).placement, "promptFooter");
	assert.equal(parseGoUsageConfig({ placement: 42 }).placement, "promptFooter");
});

test("maxWidth budget: positive ints kept, anything else auto (0)", () => {
	assert.equal(parseGoUsageConfig({ maxWidth: 56 }).maxWidth, 56);
	assert.equal(parseGoUsageConfig({ maxWidth: 0 }).maxWidth, 0);
	assert.equal(parseGoUsageConfig({ maxWidth: -20 }).maxWidth, 0);
	assert.equal(parseGoUsageConfig({ maxWidth: "80" }).maxWidth, 0);
	assert.equal(parseGoUsageConfig({ maxWidth: Number.NaN }).maxWidth, 0);
	assert.equal(parseGoUsageConfig({}).maxWidth, 0);
	assert.equal(DEFAULT_CONFIG.maxWidth, 0);
});
