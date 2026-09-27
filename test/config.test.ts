import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.ts";

const defaults = () => ({ ...DEFAULT_CONFIG, providers: [...DEFAULT_CONFIG.providers] });
const expected = (patch: Record<string, unknown>) => ({ ...defaults(), ...patch });

test("missing/invalid input falls back to defaults", () => {
	for (const garbage of [undefined, null, 42, "nope", [], { not: "a config" }]) {
		assert.deepEqual(parseConfig(garbage), defaults(), JSON.stringify(garbage));
	}
});

test("valid layouts and countdown toggle", () => {
	assert.deepEqual(parseConfig({ layout: "single" }), expected({ layout: "single" }));
	assert.deepEqual(parseConfig({ layout: "multi" }), expected({ layout: "multi" }));
	assert.deepEqual(parseConfig({ showCountdown: false }), expected({ showCountdown: false }));
	assert.deepEqual(
		parseConfig({ layout: "multi", showCountdown: false }),
		expected({ layout: "multi", showCountdown: false }),
	);
});

test("invalid field values default per-field, unknown fields ignored", () => {
	assert.deepEqual(parseConfig({ layout: "wide" }), defaults());
	assert.deepEqual(parseConfig({ layout: 42 }), defaults());
	assert.deepEqual(parseConfig({ showCountdown: "yes" }), defaults());
	assert.deepEqual(parseConfig({ layout: "single", showCountdown: 1 }), expected({ layout: "single" }));
	assert.deepEqual(parseConfig({ layout: "multi", extra: true }), expected({ layout: "multi" }));
});

test("placement option: valid values kept, invalid default", () => {
	assert.equal(parseConfig({ placement: "sidebar" }).placement, "sidebar");
	assert.equal(parseConfig({ placement: "both" }).placement, "both");
	assert.equal(parseConfig({ placement: "promptFooter" }).placement, "promptFooter");
	assert.equal(parseConfig({ placement: "never" }).placement, "promptFooter");
	assert.equal(parseConfig({ placement: 42 }).placement, "promptFooter");
});

test("maxWidth budget: positive ints kept, anything else auto (0)", () => {
	assert.equal(parseConfig({ maxWidth: 56 }).maxWidth, 56);
	assert.equal(parseConfig({ maxWidth: 0 }).maxWidth, 0);
	assert.equal(parseConfig({ maxWidth: -20 }).maxWidth, 0);
	assert.equal(parseConfig({ maxWidth: "80" }).maxWidth, 0);
	assert.equal(parseConfig({ maxWidth: Number.NaN }).maxWidth, 0);
	assert.equal(parseConfig({}).maxWidth, 0);
	assert.equal(DEFAULT_CONFIG.maxWidth, 0);
});

test("providers: single id, list, and \"all\"", () => {
	assert.deepEqual(parseConfig({ providers: "opencode-go" }).providers, ["opencode-go"]);
	assert.deepEqual(parseConfig({ providers: ["opencode-go"] }).providers, ["opencode-go"]);
	assert.deepEqual(parseConfig({ providers: "all" }).providers, ["all"]);
	assert.deepEqual(parseConfig({ providers: ["all"] }).providers, ["all"]);
	// duplicates collapse
	assert.deepEqual(parseConfig({ providers: ["opencode-go", "opencode-go"] }).providers, [
		"opencode-go",
	]);
});

test("providers: unknown ids and garbage fall back to the default list", () => {
	for (const garbage of [["nope"], ["opencode-go", "nope"], [42], {}, 7, [null]]) {
		assert.deepEqual(
			parseConfig({ providers: garbage }).providers,
			["opencode-go"],
			JSON.stringify(garbage),
		);
	}
	assert.deepEqual(DEFAULT_CONFIG.providers, ["opencode-go"]);
});
