/**
 * OpenCode Go API-key resolution for the plugin.
 *
 * Key sources (tried in order, first non-empty wins):
 *   1. OpenCode's own auth store — `{...,"opencode-go":{"type":"api","key":"..."}}`
 *      at `$OPENCODE_DATA_DIR/auth.json`, `$XDG_DATA_HOME/opencode/auth.json`, or
 *      `~/.local/share/opencode/auth.json` (verified live on 2026-09-27).
 *   2. Server-side integration connection (server plugin context only):
 *      `ctx.integration.connection.active("opencode-go")` → `resolve()` →
 *      `Credential.Value` with `type: "key"` and a `key` field.
 *
 * The key is never logged, printed, or written to any file by this plugin.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const AUTH_STORE_BASE = process.env.OPENCODE_DATA_DIR ?? process.env.XDG_DATA_HOME;

/** Candidate auth.json locations, most specific first. */
function authStoreCandidates(): string[] {
	const home = homedir();
	const candidates: string[] = [];
	if (AUTH_STORE_BASE !== undefined && AUTH_STORE_BASE !== "") {
		candidates.push(join(AUTH_STORE_BASE, "opencode", "auth.json"), join(AUTH_STORE_BASE, "auth.json"));
	}
	candidates.push(join(home, ".local", "share", "opencode", "auth.json"));
	return candidates;
}

/** Lenient auth.json reader; the API key for `opencode-go` or undefined. */
export function readApiKeyFromAuthStore(): string | undefined {
	for (const path of authStoreCandidates()) {
		try {
			const parsed = safeParse(readFileSync(path, "utf8"));
			if (!isRecord(parsed)) continue;
			const key = extractKey(parsed["opencode-go"]);
			if (key !== undefined) return key;
		} catch {
			// Missing/unreadable store → try the next candidate.
		}
	}
	return undefined;
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept `{key}` (api type), `{apiKey}/{api_key}` and credential-wrapper shapes. */
function extractKey(entry: unknown): string | undefined {
	if (!isRecord(entry)) return undefined;
	const candidates = [entry.key, entry.apiKey, entry["api_key"]];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
	}
	// /connect may store credentials under a nested wrapper.
	if (isRecord(entry.credential)) return extractKey(entry.credential);
	if (isRecord(entry.data)) return extractKey(entry.data);
	return undefined;
}

/**
 * Resolve the key through the server plugin's integration connection
 * (credential store, remote-safe). Returns undefined when OpenCode has no
 * key-method credential for opencode-go.
 */
export async function apiKeyFromIntegration(ctx: {
	integration: {
		connection: {
			active(integrationID: string): Promise<{ id: string } | undefined>;
			resolve(connection: unknown): Promise<{ type?: string; key?: string; access?: string } | undefined>;
		};
	};
	integrationID?: string;
}): Promise<string | undefined> {
	try {
		const connection = await ctx.integration.connection.active("opencode-go");
		if (connection === undefined) return undefined;
		const credential = await ctx.integration.connection.resolve(connection);
		if (credential === undefined) return undefined;
		if (credential.type === "key" && typeof credential.key === "string" && credential.key !== "") {
			return credential.key;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
