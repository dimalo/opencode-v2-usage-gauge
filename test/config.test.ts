import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, parseGoUsageConfig } from "../src/config.ts";

test("missing/invalid input falls back to defaults", () => {
	for (const garbage of [undefined, null, 42, "nope", [], { not: "a config" }]) {
		assert.deepEqual(parseGoUsageConfig(garbage), DEFAULT_CONFIG, JSON.stringify(garbage));
	}
});

test("valid layouts and countdown toggle", () => {
	const defaults = DEFAULT_CONFIG;
	assert.deepEqual(parseGoUsageConfig({ layout: "single" }), { ...defaults, layout: "single" });
	assert.deepEqual(parseGoUsageConfig({ layout: "multi" }), { ...defaults, layout: "multi" });
	assert.deepEqual(parseGoUsageConfig({ showCountdown: false }), { ...defaults, showCountdown: false });
	assert.deepEqual(
		parseGoUsageConfig({ layout: "multi", showCountdown: false }),
		{ ...defaults, layout: "multi", showCountdown: false },
	);
});

test("invalid field values default per-field, unknown fields ignored", () => {
	assert.deepEqual(parseGoUsageConfig({ layout: "wide" }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ layout: 42 }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ showCountdown: "yes" }), DEFAULT_CONFIG);
	assert.deepEqual(parseGoUsageConfig({ layout: "single", showCountdown: 1 }), {
		layout: "single",
		showCountdown: true,
		placement: "promptFooter",
	});
	assert.deepEqual(parseGoUsageConfig({ layout: "multi", extra: true }), {
		layout: "multi",
		showCountdown: true,
		placement: "promptFooter",
	});
});
test("placement option: valid values kept, invalid default", () => {
	assert.equal(parseGoUsageConfig({ placement: "sidebar" }).placement, "sidebar");
	assert.equal(parseGoUsageConfig({ placement: "both" }).placement, "both");
	assert.equal(parseGoUsageConfig({ placement: "promptFooter" }).placement, "promptFooter");
	assert.equal(parseGoUsageConfig({ placement: "never" }).placement, "promptFooter");
	assert.equal(parseGoUsageConfig({ placement: 42 }).placement, "promptFooter");
	assert.deepEqual(DEFAULT_CONFIG, { layout: "single", showCountdown: true, placement: "promptFooter" });
});
