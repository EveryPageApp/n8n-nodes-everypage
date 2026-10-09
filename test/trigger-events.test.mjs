// Pins the EveryPage Trigger's webhook event options (run with `node --test`
// after `npm run build` - they exercise the compiled output the package
// actually ships). The options mirror the API's subscribable kinds, so a kind
// added on the server needs an option here, and n8n's linter requires the
// option names in alphabetical order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EveryPageTrigger } = require('../dist/nodes/EveryPageTrigger/EveryPageTrigger.node.js');

const eventsProperty = new EveryPageTrigger().description.properties.find((p) => p.name === 'events');
const options = eventsProperty.options;

const API_KINDS = [
	'content.replaced',
	'file.burned',
	'file.downloaded',
	'file.opened',
	'file.viewed',
	'gate.completed',
	'invite.viewed',
	'note.created',
	'proofing.updated',
	'receipt.confirmed',
];

test('offers exactly the API webhook kinds', () => {
	assert.deepEqual(options.map((o) => o.value).sort(), API_KINDS);
});

test('offers file.opened as File Opened', () => {
	const opened = options.find((o) => o.value === 'file.opened');
	assert.ok(opened, 'file.opened option missing');
	assert.equal(opened.name, 'File Opened');
});

test('keeps option names in alphabetical order', () => {
	const names = options.map((o) => o.name);
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('describes every option', () => {
	for (const o of options) {
		assert.ok(typeof o.description === 'string' && o.description.length > 0, `${o.value} has no description`);
	}
});

test('still defaults to file.viewed', () => {
	assert.deepEqual(eventsProperty.default, ['file.viewed']);
});
