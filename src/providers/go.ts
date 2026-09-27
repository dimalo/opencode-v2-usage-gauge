/**
 * OpenCode Go plan adapter.
 *
 * Endpoint: `GET https://opencode.ai/zen/go/v1/usage` (Bearer auth, live since
 * 2026-08-11, upstream PR anomalyco/opencode#16513). The response shape is not
 * formally pinned, so the lenient parser in `src/parser.ts` (ported verbatim
 * from the pi extension) does the reading; this adapter only normalizes its
 * output into `PlanUsage`.
 *
 * Credentials come from OpenCode's own auth store — the key the user already
 * connected for this provider. No cookie, no workspace id, nothing to paste.
 * The key is never logged, printed or persisted.
 */

import { readApiKeyFromAuthStore } from "../auth.ts";
import { parseUsageResponse } from "../parser.ts";
import type { Credential, PlanOutcome, PlanUsage, PlanUsageAdapter } from "./types.ts";

export const GO_PROVIDER_ID = "opencode-go";
export const GO_ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
export const REQUEST_TIMEOUT_MS = 10_000;

export const GO_ADAPTER: PlanUsageAdapter = {
	id: GO_PROVIDER_ID,
	label: "OpenCode Go",
	planKind: "windows",

	async credential(): Promise<Credential | undefined> {
		const key = await readApiKeyFromAuthStore(GO_PROVIDER_ID);
		return key === undefined ? undefined : { kind: "bearer", token: key };
	},

	async fetch(credential: Credential): Promise<PlanOutcome> {
		if (credential.kind !== "bearer") {
			return { ok: false, kind: "no-credential", error: "Expected an API key for OpenCode Go." };
		}

		let res: Response;
		try {
			res = await fetch(GO_ENDPOINT, {
				headers: { Authorization: `Bearer ${credential.token}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			return { ok: false, kind: "transient", error: "Usage request failed (network error or timeout)." };
		}

		if (res.status === 401) {
			return { ok: false, kind: "unauthorized", error: "Plan/key rejected (HTTP 401) for opencode-go." };
		}
		if (!res.ok) {
			return { ok: false, kind: "transient", error: `Usage endpoint returned HTTP ${res.status}.` };
		}

		let json: unknown;
		try {
			json = await res.json();
		} catch {
			return { ok: false, kind: "payload", error: "Usage response was not valid JSON." };
		}

		const parsed = parseUsageResponse(json);
		if (!parsed.valid || parsed.windows.length === 0) {
			return {
				ok: false,
				kind: "payload",
				error: "Usage response contained no recognizable window data.",
			};
		}

		const data: PlanUsage = {
			provider: GO_PROVIDER_ID,
			windows: parsed.windows.map((window) => ({
				key: window.key,
				label: window.label,
				usagePercent: window.usagePercent,
				limitDollars: window.limitDollars,
				resetsAtMs: window.resetsAtMs,
				resetInSec: window.resetInSec,
				status: window.status,
			})),
			fetchedMs: parsed.fetchedAtMs,
			valid: parsed.valid,
		};
		return { ok: true, data };
	},
};
