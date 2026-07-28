// Unit tests for the field -> PUT /settings payload mapping, the share trio,
// the multipart builder, and the error mapping. These pin the cross-
// integration contract: input keys and output keys must stay identical to
// the EveryPage Zapier app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	settingsFromOptions,
	variantOverridesFromOptions,
	shareTrio,
	buildMultipartBody,
	isPdf,
	mapApiError,
	PRICING_URL,
} = require('../dist/nodes/EveryPage/GenericFunctions.js');

const BASE = 'https://everypage.co';

// ---------------------------------------------------------------------------
// settingsFromOptions
// ---------------------------------------------------------------------------

test('empty input produces an empty settings payload', () => {
	assert.deepEqual(settingsFromOptions({}), {});
});

test('passcode maps to the API password field', () => {
	assert.deepEqual(settingsFromOptions({ passcode: 'hunter2' }), { password: 'hunter2' });
});

test('clearPasscode wins over passcode and sends the empty string', () => {
	assert.deepEqual(settingsFromOptions({ passcode: 'hunter2', clearPasscode: true }), {
		password: '',
	});
});

test('neverExpire overrides expiryHours', () => {
	const settings = settingsFromOptions({ neverExpire: true, expiryHours: 24 });
	assert.deepEqual(settings, { neverExpire: true });
});

test('expiryHours becomes a deleteAt timestamp in the future', () => {
	const before = Date.now();
	const settings = settingsFromOptions({ expiryHours: 48 });
	const deleteAt = Date.parse(settings.deleteAt);
	assert.ok(deleteAt >= before + 48 * 3600 * 1000 - 1000);
	assert.ok(deleteAt <= Date.now() + 48 * 3600 * 1000 + 1000);
});

test('booleans tolerate string forms (expression output)', () => {
	assert.deepEqual(settingsFromOptions({ allowDownload: 'false' }), { allowDownload: false });
	assert.deepEqual(settingsFromOptions({ watermark: 'true' }), { watermark: true });
});

test('unset booleans are omitted (false is distinct from not set)', () => {
	const settings = settingsFromOptions({ allowDownload: false });
	assert.deepEqual(settings, { allowDownload: false });
	assert.ok(!('watermark' in settings));
});

test('protect toggles fold into viewerSettings.protect with API names', () => {
	assert.deepEqual(
		settingsFromOptions({
			blockRightClick: true,
			blockPrint: true,
			blockCopy: false,
			blurOnLeave: true,
		}),
		{
			viewerSettings: {
				protect: { contextMenu: true, print: true, select: false, blurOnLeave: true },
			},
		},
	);
});

test('gateDomains filters empties and drops empty lists', () => {
	assert.deepEqual(settingsFromOptions({ gateDomains: ['acme.com', '', 'ex.co'] }), {
		gateDomains: ['acme.com', 'ex.co'],
	});
	assert.deepEqual(settingsFromOptions({ gateDomains: [''] }), {});
});

test('page range assembles the pair, 0/0 clears', () => {
	assert.deepEqual(settingsFromOptions({ pageFrom: 2, pageTo: 5 }), {
		pageRange: { from: 2, to: 5 },
	});
	assert.deepEqual(settingsFromOptions({ pageFrom: 0, pageTo: 0 }), {
		pageRange: { from: 0, to: 0 },
	});
});

test('full surface maps every pinned field name', () => {
	const settings = settingsFromOptions({
		viewerMode: 'flipbook',
		passcode: 'code',
		allowDownload: true,
		expiryHours: 24,
		notifyOnView: true,
		viewLimit: 3,
		askReceipt: true,
		requireEmail: true,
		gateDomains: ['acme.com'],
		slug: 'q3-proposal',
		watermark: true,
		pageFrom: 1,
		pageTo: 9,
	});
	assert.equal(settings.viewerMode, 'flipbook');
	assert.equal(settings.password, 'code');
	assert.equal(settings.allowDownload, true);
	assert.ok(settings.deleteAt);
	assert.equal(settings.notifyOnView, true);
	assert.equal(settings.viewLimit, 3);
	assert.equal(settings.askReceipt, true);
	assert.equal(settings.requireEmail, true);
	assert.deepEqual(settings.gateDomains, ['acme.com']);
	assert.equal(settings.slug, 'q3-proposal');
	assert.equal(settings.watermark, true);
	assert.deepEqual(settings.pageRange, { from: 1, to: 9 });
});

// ---------------------------------------------------------------------------
// variantOverridesFromOptions
// ---------------------------------------------------------------------------

test('variant overrides only build when a field is provided', () => {
	assert.equal(variantOverridesFromOptions({}), undefined);
	assert.deepEqual(variantOverridesFromOptions({ allowDownload: false }), {
		allowDownload: false,
	});
	assert.deepEqual(variantOverridesFromOptions({ pageFrom: 0, pageTo: 0 }), {
		pageRange: { from: 0, to: 0 },
	});
});

// ---------------------------------------------------------------------------
// shareTrio: field names pinned to the Zapier app's outputs
// ---------------------------------------------------------------------------

test('shareTrio prefers the short ID for share and embed URLs', () => {
	const uuid = '550e8400-e29b-41d4-a716-446655440000';
	const trio = shareTrio(BASE, uuid, 'aB3xY9kQ2mZ7');
	assert.deepEqual(Object.keys(trio).sort(), ['embed_code', 'qr_url', 'shareUrl']);
	assert.equal(trio.shareUrl, `${BASE}/aB3xY9kQ2mZ7`);
	// The public QR path keys off the UUID (the public endpoint's identifier).
	assert.equal(trio.qr_url, `${BASE}/api/files/${uuid}/qr-code`);
	assert.equal(
		trio.embed_code,
		`<iframe src="${BASE}/embed/aB3xY9kQ2mZ7" width="800" height="600" frameborder="0" allowfullscreen></iframe>`,
	);
});

test('shareTrio falls back to the UUID when there is no short ID', () => {
	const uuid = '550e8400-e29b-41d4-a716-446655440000';
	const trio = shareTrio(BASE, uuid, undefined);
	assert.equal(trio.shareUrl, `${BASE}/${uuid}`);
	assert.ok(trio.embed_code.includes(`/embed/${uuid}`));
});

// ---------------------------------------------------------------------------
// Multipart builder + PDF sniffing
// ---------------------------------------------------------------------------

test('multipart body wraps the bytes with the file part', () => {
	const content = Buffer.from('%PDF-1.7 fake');
	const { body, contentType } = buildMultipartBody('file', 'proposal.pdf', content);
	const boundary = contentType.split('boundary=')[1];
	assert.ok(boundary);
	const text = body.toString('latin1');
	assert.ok(text.startsWith(`--${boundary}\r\n`));
	assert.ok(text.includes('Content-Disposition: form-data; name="file"; filename="proposal.pdf"'));
	assert.ok(text.includes('Content-Type: application/pdf'));
	assert.ok(text.includes('%PDF-1.7 fake'));
	assert.ok(text.endsWith(`\r\n--${boundary}--\r\n`));
});

test('multipart filename is sanitised against header injection', () => {
	const { body } = buildMultipartBody('file', 'a"\r\nX: y.pdf', Buffer.from('%PDF-'));
	const text = body.toString('latin1');
	// CR/LF and quotes are stripped so the disposition line cannot be broken
	// out of - no injected header line survives.
	assert.ok(!text.includes('\r\nX:'));
	assert.ok(text.includes('filename="a___X: y.pdf"'));
});

test('isPdf sniffs magic bytes', () => {
	assert.equal(isPdf(Buffer.from('%PDF-1.4\n...')), true);
	assert.equal(isPdf(Buffer.from('PK\x03\x04 docx bytes')), false);
	assert.equal(isPdf(Buffer.from('')), false);
});

// ---------------------------------------------------------------------------
// Error mapping: plain-text bodies, status-driven, key never leaks
// ---------------------------------------------------------------------------

const FAKE_NODE = {
	id: '1',
	name: 'EveryPage',
	type: 'n8n-nodes-everypage.everyPage',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

test('403 plan gates name the plan and link pricing', () => {
	const err = mapApiError(FAKE_NODE, 403, 'This feature requires the pro plan or higher');
	assert.ok(err.message.includes('pro plan'));
	assert.ok(`${err.message} ${err.description ?? ''}`.includes(PRICING_URL));
});

test('413 names the plan size caps', () => {
	const err = mapApiError(FAKE_NODE, 413, 'Request Entity Too Large');
	const text = `${err.message} ${err.description ?? ''}`;
	assert.ok(text.includes('20 MiB'));
	assert.ok(text.includes('200 MiB'));
	assert.ok(text.includes('2 GiB'));
});

test('410 explains expired/burned', () => {
	const err = mapApiError(FAKE_NODE, 410, 'gone');
	assert.ok(err.message.toLowerCase().includes('no longer live'));
});

test('429 mentions the 120/min limit', () => {
	const err = mapApiError(FAKE_NODE, 429, 'Too Many Requests');
	assert.ok(err.message.includes('120 requests per minute'));
});

test('errors never contain an API key', () => {
	for (const status of [400, 401, 403, 404, 410, 413, 429, 500]) {
		const err = mapApiError(FAKE_NODE, status, 'some upstream text');
		const dump = JSON.stringify({ m: err.message, d: err.description ?? '' });
		assert.ok(!dump.includes('ep_live_'));
		assert.ok(!dump.toLowerCase().includes('authorization'));
	}
});
