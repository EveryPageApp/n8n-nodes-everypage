import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IPollFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// Shared plumbing for both EveryPage nodes. The field names, plan-gating
// error copy, and output shapes here deliberately mirror the EveryPage
// Zapier app (the reference implementation) so the automation integrations
// never drift semantically.

export const DEFAULT_BASE_URL = 'https://everypage.co';
export const PRICING_URL = 'https://everypage.co/pricing';

export type EveryPageContext =
	IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IPollFunctions | IWebhookFunctions;

export async function getBaseUrl(this: EveryPageContext): Promise<string> {
	const credentials = await this.getCredentials('everyPageApi');
	const raw = (credentials.baseUrl as string) || DEFAULT_BASE_URL;
	return raw.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Error mapping
//
// EveryPage error bodies are PLAIN TEXT (not JSON), so we branch on the HTTP
// status and surface the raw text inside a clear, actionable message. The
// API key never appears in any thrown error: errors are constructed from the
// status + body text only, never from the request config.
// ---------------------------------------------------------------------------

const PLAN_GATE_RE = /requires the (basic|pro) plan/i;

export function mapApiError(node: INode, statusCode: number, bodyText: string): Error {
	const text = String(bodyText || '').trim();

	if (statusCode === 401) {
		return new NodeApiError(node, { message: text } as JsonObject, {
			message: 'Your EveryPage API key is invalid or has been revoked',
			description: 'Create a fresh key at everypage.co/account under API keys.',
			httpCode: '401',
		});
	}
	if (statusCode === 403) {
		// Plan-tier refusals are plain text ("This feature requires the pro plan
		// or higher"). Point at the fix, not just the refusal.
		if (PLAN_GATE_RE.test(text)) {
			return new NodeApiError(node, { message: text } as JsonObject, {
				message: text,
				description: `Upgrade your EveryPage plan at ${PRICING_URL} and re-run this step.`,
				httpCode: '403',
			});
		}
		return new NodeApiError(node, { message: text } as JsonObject, {
			message: `That action is not allowed on your plan or account: ${text}`,
			httpCode: '403',
		});
	}
	if (statusCode === 404) {
		return new NodeApiError(node, { message: text } as JsonObject, {
			message: 'That document (or resource) was not found',
			description:
				'It may have been deleted, or it belongs to a different EveryPage account than this credential uses.',
			httpCode: '404',
		});
	}
	if (statusCode === 410) {
		return new NodeApiError(node, { message: text } as JsonObject, {
			message: 'That link is no longer live — it expired, or was burned by its view limit',
			description:
				'An expired link cannot be revived; a burned link un-burns via the Replace Content operation.',
			httpCode: '410',
		});
	}
	if (statusCode === 413) {
		return new NodeApiError(node, { message: text } as JsonObject, {
			message: 'That PDF is larger than your plan allows',
			description: `Plan size caps: Free 20 MiB, Basic 200 MiB, Pro 2 GiB. Send a smaller file, or upgrade at ${PRICING_URL}.`,
			httpCode: '413',
		});
	}
	if (statusCode === 429) {
		return new NodeApiError(node, { message: text } as JsonObject, {
			message: 'EveryPage rate limit reached (120 requests per minute per API key)',
			description: 'Wait a minute and retry, or enable "Retry On Fail" in this node\'s settings.',
			httpCode: '429',
		});
	}
	return new NodeApiError(node, { message: text } as JsonObject, {
		message: `Unexpected EveryPage response (${statusCode}): ${text}`,
		httpCode: String(statusCode),
	});
}

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

export interface EveryPageRequestOptions {
	body?: IDataObject | Buffer;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Return the raw bytes (Buffer) instead of parsed JSON. */
	binary?: boolean;
}

export async function everyPageApiRequest(
	this: EveryPageContext,
	method: IHttpRequestMethods,
	path: string,
	{ body, qs, headers, binary }: EveryPageRequestOptions = {},
): Promise<any> {
	const baseUrl = await getBaseUrl.call(this);

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		returnFullResponse: true,
		// Error bodies are plain text and statuses carry the meaning - we branch
		// on the code ourselves instead of letting the helper throw (its thrown
		// error would drag request config, and with it the auth header, along).
		ignoreHttpStatusErrors: true,
	};
	if (qs && Object.keys(qs).length) options.qs = qs;
	if (headers && Object.keys(headers).length) options.headers = headers as IDataObject;
	if (body !== undefined) options.body = body;
	if (binary) {
		options.encoding = 'arraybuffer';
		options.json = false;
	}

	const response = await this.helpers.httpRequestWithAuthentication.call(
		this,
		'everyPageApi',
		options,
	);

	const statusCode = (response.statusCode ?? response.status ?? 0) as number;
	let responseBody = response.body;

	if (statusCode >= 400) {
		if (Buffer.isBuffer(responseBody)) responseBody = responseBody.toString('utf8');
		if (typeof responseBody === 'object' && responseBody !== null) {
			responseBody = JSON.stringify(responseBody);
		}
		throw mapApiError(this.getNode(), statusCode, String(responseBody ?? ''));
	}

	if (binary) {
		return Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(responseBody ?? '');
	}
	// Success bodies are JSON (already parsed by the helper) except the empty
	// 200 from the settings PUT.
	if (typeof responseBody === 'string' && responseBody.trim() === '') return undefined;
	if (typeof responseBody === 'string') {
		try {
			return JSON.parse(responseBody);
		} catch {
			return responseBody;
		}
	}
	return responseBody;
}

// ---------------------------------------------------------------------------
// Multipart upload (dependency-free)
//
// Verified community nodes may not ship runtime dependencies, so the
// multipart body is assembled by hand instead of via form-data.
// ---------------------------------------------------------------------------

export function buildMultipartBody(
	fieldName: string,
	filename: string,
	content: Buffer,
	contentType = 'application/pdf',
): { body: Buffer; contentType: string } {
	const boundary = `----everypage${randomBytes(16).toString('hex')}`;
	const safeName = String(filename).replace(/[\r\n"]/g, '_');
	const head = Buffer.from(
		`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${fieldName}"; filename="${safeName}"\r\n` +
			`Content-Type: ${contentType}\r\n\r\n`,
		'utf8',
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
	return {
		body: Buffer.concat([head, content, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

export function isPdf(buffer: Buffer): boolean {
	return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

// ---------------------------------------------------------------------------
// The share-output trio every file-producing operation returns.
//
// Field names (shareUrl / qr_url / embed_code) are pinned to the Zapier app's
// output keys. Values key off DURABLE identifiers only - the short ID where
// known, the UUID otherwise, and NEVER the renameable vanity slug - because
// outputs end up in frozen places (emails, CRM notes, printed QR codes).
// qr_url uses the PUBLIC /api/files/... path on purpose: whatever downstream
// app renders the QR image has no EveryPage credentials.
// ---------------------------------------------------------------------------

export function shareTrio(
	baseUrl: string,
	uuid: string,
	shortId?: string,
): { shareUrl: string; qr_url: string; embed_code: string } {
	const durableId = shortId || uuid;
	return {
		shareUrl: `${baseUrl}/${durableId}`,
		qr_url: `${baseUrl}/api/files/${uuid}/qr-code`,
		embed_code: `<iframe src="${baseUrl}/embed/${durableId}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`,
	};
}

// ---------------------------------------------------------------------------
// Settings mapping: node option fields -> PUT /api/v1/files/{uuid}/settings
//
// Shared by Upload, Import From URL, and Update Settings so they can never
// drift apart. Only fields the user actually set are sent - the API keeps
// omitted fields at their current value. Input keys are pinned to the Zapier
// app's field names (`passcode` not `password`, expiryHours/neverExpire,
// blockRightClick/blockPrint/blockCopy/blurOnLeave, pageFrom/pageTo).
// ---------------------------------------------------------------------------

export function asBool(value: unknown): boolean | undefined {
	if (value === true || value === 'true') return true;
	if (value === false || value === 'false') return false;
	return undefined;
}

export function hasValue(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

function setBool(settings: IDataObject, key: string, value: unknown): void {
	const b = asBool(value);
	if (b !== undefined) settings[key] = b;
}

// Node protect toggles -> the API's viewerSettings.protect block. The node
// names describe what the user experiences; the API names describe the
// browser mechanism being disabled.
const PROTECT_MAP: Record<string, string> = {
	blockRightClick: 'contextMenu',
	blockPrint: 'print',
	blockCopy: 'select',
	blurOnLeave: 'blurOnLeave',
};

export function settingsFromOptions(input: IDataObject): IDataObject {
	const settings: IDataObject = {};

	if (hasValue(input.viewerMode)) settings.viewerMode = input.viewerMode;

	// `passcode` is a per-document view code, not an auth credential - it maps
	// to the API's `password` field. An empty string clears the code
	// server-side, which is what the explicit clearPasscode toggle sends;
	// clearing wins over setting.
	if (asBool(input.clearPasscode)) {
		settings.password = '';
	} else if (hasValue(input.passcode)) {
		settings.password = input.passcode;
	}

	setBool(settings, 'allowDownload', input.allowDownload);

	if (asBool(input.neverExpire)) {
		settings.neverExpire = true;
	} else if (hasValue(input.expiryHours)) {
		settings.deleteAt = new Date(
			Date.now() + Number(input.expiryHours) * 3600 * 1000,
		).toISOString();
	}

	setBool(settings, 'notifyOnView', input.notifyOnView);
	if (hasValue(input.viewLimit)) settings.viewLimit = Number(input.viewLimit);
	setBool(settings, 'askReceipt', input.askReceipt);
	setBool(settings, 'requireEmail', input.requireEmail);

	if (Array.isArray(input.gateDomains)) {
		const domains = (input.gateDomains as unknown[]).filter(hasValue);
		if (domains.length) settings.gateDomains = domains;
	}

	if (hasValue(input.slug)) settings.slug = input.slug;
	setBool(settings, 'watermark', input.watermark);

	// Page range: a valid pair (1 <= from <= to) limits non-owner viewers to
	// that window; the explicit {from:0,to:0} pair is the API's "no range"
	// value, so typing 0/0 clears an existing range.
	if (hasValue(input.pageFrom) || hasValue(input.pageTo)) {
		settings.pageRange = {
			from: hasValue(input.pageFrom) ? Number(input.pageFrom) : 0,
			to: hasValue(input.pageTo) ? Number(input.pageTo) : 0,
		};
	}

	const protect: IDataObject = {};
	for (const [inputKey, apiKey] of Object.entries(PROTECT_MAP)) {
		const b = asBool(input[inputKey]);
		if (b !== undefined) protect[apiKey] = b;
	}
	// CAVEAT (documented API ordering): the viewerSettings blob commits BEFORE
	// later validation in the same PUT - a late 400/403/409 (e.g. a taken
	// slug) can leave the blob written. Keep protect toggles and risky fields
	// in separate node runs when that matters.
	if (Object.keys(protect).length) settings.viewerSettings = { protect };

	return settings;
}

// ---------------------------------------------------------------------------
// Variant overrides. WARNING (API contract): `overrides` REPLACES the whole
// object server-side, never merges - {} clears all overrides.
// ---------------------------------------------------------------------------

export function variantOverridesFromOptions(input: IDataObject): IDataObject | undefined {
	const overrides: IDataObject = {};
	const allowDownload = asBool(input.allowDownload);
	if (allowDownload !== undefined) overrides.allowDownload = allowDownload;
	if (hasValue(input.pageFrom) || hasValue(input.pageTo)) {
		overrides.pageRange = {
			from: hasValue(input.pageFrom) ? Number(input.pageFrom) : 0,
			to: hasValue(input.pageTo) ? Number(input.pageTo) : 0,
		};
	}
	return Object.keys(overrides).length ? overrides : undefined;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
//
// X-Everypage-Signature: "t=<unix>,v1=<hex>" where v1 is HMAC-SHA256 over
// "<t>.<raw body>" keyed with the FULL whsec_-prefixed secret (the prefix is
// part of the key). Stale timestamps (over `toleranceSeconds` of skew) are
// rejected to blunt replay, and the comparison is constant-time.
// ---------------------------------------------------------------------------

export const SIGNATURE_HEADER = 'x-everypage-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyWebhookSignature(
	secret: string,
	signatureHeader: string | undefined,
	rawBody: Buffer | string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
	toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
	if (!secret) return false;
	const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(signatureHeader ?? ''));
	if (!match) return false;
	const [, t, v1] = match;

	if (Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;

	const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
	const expected = createHmac('sha256', secret)
		.update(Buffer.concat([Buffer.from(`${t}.`, 'utf8'), bodyBuffer]))
		.digest();
	let given: Buffer;
	try {
		given = Buffer.from(v1, 'hex');
	} catch {
		return false;
	}
	if (given.length !== expected.length) return false;
	return timingSafeEqual(given, expected);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function throwNoPdf(node: INode, source: string): never {
	throw new NodeOperationError(node, `${source} is not a PDF`, {
		description:
			'The EveryPage API accepts PDF bytes only (the Word-to-PDF conversion lane is a web-app upload feature, not part of the API). Convert the document to PDF in an earlier step.',
	});
}

export function isNotFoundApiError(error: unknown): boolean {
	const err = error as { httpCode?: string; statusCode?: number } | undefined;
	return err !== undefined && (err.httpCode === '404' || err.statusCode === 404);
}
