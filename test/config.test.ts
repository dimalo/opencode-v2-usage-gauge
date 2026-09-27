import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, parseGoUsageConfig } from "../src/config.ts";

test("missing/invalid input falls back to defaults", () => {
	for (const garbage of [undefined, null, 42, "nope", [], { not: "a config" }]) {
		assert.deepEqual(parseGoUsageConfig(garbage), DEFAULT_CONFIG, JSON.stringify(garbage));
	}
});

test("valid layouts and countdown toggle", () => {
	assert.deepEqual(parseGoUsageConfig({ layout: "single" }), { layout: "single", showCountdown: true });
	assert.deepEqual(parseGoUsageConfig({ layout: "multi" }), { layout: "multi", showCountdown: true });
	assert.deepEqual(parseGoUsageConfig({ showCountdown: false }), { layout: "single", showCountdown: false });
	assert.deepEqual(parseGoUsageConfig({ layout: "multi", showCountdown: false }), {
		layout: "multi",
		showCountdown: false,
	});
});

test("invalid field values default per-field, unknown fields ignored", () => {
	assert.deepEqual(parseGoUsageConfig({ layout: "wide" }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ layout: 42 }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ showCountdown: "yes" }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ layout: "single", showCountdown: 1 }), {
		layout: "single",
		showCountdown: true,
	});
	assert.deepEqual(parseGoUsageConfig({ layout: "multi", extra: true }), {
		layout: "multi",
		showCountdown: true,
	});
});