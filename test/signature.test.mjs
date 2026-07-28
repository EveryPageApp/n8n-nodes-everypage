// Unit tests for webhook signature verification (run with `node --test`
// after `npm run build` - they exercise the compiled output the package
// actually ships).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyWebhookSignature } = require('../dist/nodes/EveryPage/GenericFunctions.js');

// The FULL whsec_-prefixed secret is the HMAC key - the prefix is part of
// the key, exactly as the platform signs.
const SECRET = 'whsec_9a1f2b3c4d5e6f708192a3b4c5d6e7f8';
const BODY = JSON.stringify({
	event: 'file.viewed',
	timestamp: '2026-07-28T12:00:00Z',
	data: { fileUuid: '550e8400-e29b-41d4-a716-446655440000', fileName: 'Q3-proposal.pdf' },
});

const sign = (secret, t, body) =>
	`t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const NOW = 1_785_000_000;

test('accepts a valid signature', () => {
	assert.equal(verifyWebhookSignature(SECRET, sign(SECRET, NOW, BODY), BODY, NOW), true);
});

test('accepts a valid signature with a Buffer body', () => {
	assert.equal(
		verifyWebhookSignature(SECRET, sign(SECRET, NOW, BODY), Buffer.from(BODY, 'utf8'), NOW),
		true,
	);
});

test('accepts within the 5-minute tolerance window', () => {
	assert.equal(verifyWebhookSignature(SECRET, sign(SECRET, NOW - 299, BODY), BODY, NOW), true);
	assert.equal(verifyWebhookSignature(SECRET, sign(SECRET, NOW + 299, BODY), BODY, NOW), true);
});

test('rejects a stale timestamp (replay protection)', () => {
	assert.equal(verifyWebhookSignature(SECRET, sign(SECRET, NOW - 301, BODY), BODY, NOW), false);
	assert.equal(verifyWebhookSignature(SECRET, sign(SECRET, NOW + 301, BODY), BODY, NOW), false);
});

test('rejects a tampered body', () => {
	const tampered = BODY.replace('Q3-proposal.pdf', 'evil.pdf');
	assert.equal(verifyWebhookSignature(SECRET, sign(SECRET, NOW, BODY), tampered, NOW), false);
});

test('rejects the wrong secret', () => {
	assert.equal(
		verifyWebhookSignature('whsec_other', sign(SECRET, NOW, BODY), BODY, NOW),
		false,
	);
});

test('the whsec_ prefix is part of the key, not stripped', () => {
	// Signing with the prefix-stripped secret must NOT verify against the
	// full-secret verification.
	const stripped = SECRET.replace(/^whsec_/, '');
	assert.equal(verifyWebhookSignature(SECRET, sign(stripped, NOW, BODY), BODY, NOW), false);
});

test('rejects malformed headers', () => {
	assert.equal(verifyWebhookSignature(SECRET, undefined, BODY, NOW), false);
	assert.equal(verifyWebhookSignature(SECRET, '', BODY, NOW), false);
	assert.equal(verifyWebhookSignature(SECRET, 'v1=deadbeef', BODY, NOW), false);
	assert.equal(verifyWebhookSignature(SECRET, `t=${NOW}`, BODY, NOW), false);
	assert.equal(verifyWebhookSignature(SECRET, `t=${NOW},v1=nothex!!`, BODY, NOW), false);
	// Truncated (wrong-length) hex must fail even if it is a prefix of the
	// real digest.
	const valid = sign(SECRET, NOW, BODY);
	assert.equal(verifyWebhookSignature(SECRET, valid.slice(0, -2), BODY, NOW), false);
});

test('rejects when the secret is missing', () => {
	assert.equal(verifyWebhookSignature('', sign(SECRET, NOW, BODY), BODY, NOW), false);
	assert.equal(verifyWebhookSignature(undefined, sign(SECRET, NOW, BODY), BODY, NOW), false);
});
