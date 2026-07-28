import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import type { JsonObject, NodeConnectionType } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import {
	everyPageApiRequest,
	isNotFoundApiError,
	SIGNATURE_HEADER,
	verifyWebhookSignature,
} from '../EveryPage/GenericFunctions';

// The polling fallback covers the streams the /api/v1/events feed carries
// (view, download, gate) - the other webhook kinds have no replayable feed.
const POLL_STREAMS = ['view', 'download', 'gate'] as const;

export class EveryPageTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EveryPage Trigger',
		name: 'everyPageTrigger',
		icon: { light: 'file:everypage.svg', dark: 'file:everypage.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["triggerMode"] === "poll" ? "poll" : "instant"}}',
		description:
			'Starts a workflow when EveryPage documents are read, downloaded, gated, commented on, or burned - instantly via signed webhooks, or by polling for firewalled self-hosts',
		defaults: { name: 'EveryPage Trigger' },
		// n8n-workflow types this property as the literal `true` (false is not
		// expressible), and the community-node linter requires it present.
		// Triggers are never offered as AI-agent tools at runtime regardless.
		usableAsTool: true,
		inputs: [],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [{ name: 'everyPageApi', required: true }],
		polling: true,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Trigger Mode',
				name: 'triggerMode',
				type: 'options',
				options: [
					{
						name: 'Webhook (Instant)',
						value: 'webhook',
						description:
							'EveryPage delivers events to n8n the moment they happen, signed with HMAC-SHA256. Requires this n8n to be reachable from the internet.',
					},
					{
						name: 'Poll',
						value: 'poll',
						description:
							'Pulls the events feed on a schedule - for self-hosted n8n instances that cannot receive inbound webhooks. Covers view, download, and gate events only.',
					},
				],
				default: 'webhook',
				description:
					'How events reach n8n. Poll Times in the node settings only apply in Poll mode.',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				displayOptions: { show: { triggerMode: ['webhook'] } },
				options: [
					{
						name: 'Content Replaced',
						value: 'content.replaced',
						description: 'The PDF behind a share link was swapped in place',
					},
					{
						name: 'File Burned',
						value: 'file.burned',
						description: 'A link self-destructed - its view limit was reached',
					},
					{
						name: 'File Downloaded',
						value: 'file.downloaded',
						description: 'A reader (not you) saved one of your documents to disk',
					},
					{
						name: 'File Viewed',
						value: 'file.viewed',
						description:
							'A reader finished a viewing session, with pages viewed, time spent, and link-variant attribution',
					},
					{
						name: 'Gate Completed',
						value: 'gate.completed',
						description:
							'A viewer completed the email gate or lead-capture form; the captured fields ride along. Requires the Pro plan at event time (<a href="https://everypage.co/pricing">pricing</a>).',
					},
					{
						name: 'Invite Viewed',
						value: 'invite.viewed',
						description: 'An invited recipient opened their invite link',
					},
					{
						name: 'Note Created',
						value: 'note.created',
						description: 'A reader left a feedback note on one of your documents',
					},
					{
						name: 'Proofing Updated',
						value: 'proofing.updated',
						description: 'A proofing decision changed on one of your documents',
					},
					{
						name: 'Receipt Confirmed',
						value: 'receipt.confirmed',
						description:
							'A viewer confirmed receipt of a document that asks for it (the Ask Viewers to Confirm Receipt setting)',
					},
				],
				default: ['file.viewed'],
			},
			{
				displayName: 'Event Streams',
				name: 'pollStreams',
				type: 'multiOptions',
				required: true,
				displayOptions: { show: { triggerMode: ['poll'] } },
				options: [
					{
						name: 'Download',
						value: 'download',
						description: 'Explicit PDF downloads (the feed includes your own saves)',
					},
					{
						name: 'Gate',
						value: 'gate',
						description:
							'Email-gate / lead-form completions with the captured fields. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
					},
					{
						name: 'View',
						value: 'view',
						description: 'Read sessions with pages viewed and time spent',
					},
				],
				default: ['view'],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Document Name or ID',
						name: 'file',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getFiles' },
						default: '',
						hint: 'Only fire for this document - leave unset to fire for all your documents',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const files = (await everyPageApiRequest.call(this, 'GET', '/api/v1/files')) as
					IDataObject[] | undefined;
				return (files ?? []).map((file) => ({
					name: `${file.originalName as string} (${(file.shortId as string) || (file.uuid as string)})`,
					value: file.uuid as string,
				}));
			},
		},
	};

	// -------------------------------------------------------------------------
	// Instant mode: programmatic webhook subscription lifecycle.
	//
	// Activate -> POST /api/v1/webhooks {url, events, format: "json", fileUuid?}
	// and stash the webhook uuid + signing secret (shown exactly once in the
	// create response) in workflow static data. Deactivate -> DELETE the
	// subscription (a 404 means it is already gone - deleted in the dashboard
	// or cleaned up after auto-disable - which is the state we wanted).
	// -------------------------------------------------------------------------
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const triggerMode = this.getNodeParameter('triggerMode') as string;
				if (triggerMode !== 'webhook') return true; // nothing to register in poll mode

				const staticData = this.getWorkflowStaticData('node');
				if (!staticData.webhookUuid) return false;

				const response = (await everyPageApiRequest.call(this, 'GET', '/api/v1/webhooks')) as {
					webhooks?: IDataObject[];
				};
				const webhookUrl = this.getNodeWebhookUrl('default');
				const existing = (response.webhooks ?? []).find(
					(hook) => hook.uuid === staticData.webhookUuid && hook.url === webhookUrl,
				);
				if (!existing) {
					// Stale reference (deleted in the dashboard, or the n8n URL
					// changed) - forget it so create() runs fresh.
					delete staticData.webhookUuid;
					delete staticData.webhookSecret;
					return false;
				}
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const triggerMode = this.getNodeParameter('triggerMode') as string;
				if (triggerMode !== 'webhook') return true;

				const events = this.getNodeParameter('events') as string[];
				const options = this.getNodeParameter('options', {}) as IDataObject;
				const body: IDataObject = {
					url: this.getNodeWebhookUrl('default'),
					events,
					format: 'json',
				};
				if (options.file) body.fileUuid = options.file;

				const response = (await everyPageApiRequest.call(this, 'POST', '/api/v1/webhooks', {
					body,
				})) as { webhook: IDataObject; secret: string };

				// The signing secret (whsec_...) is shown exactly once, in this
				// response. It stays in workflow static data - server-side state,
				// never exposed in the editor - and is the HMAC key for verifying
				// every delivery.
				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookUuid = response.webhook.uuid;
				staticData.webhookSecret = response.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const triggerMode = this.getNodeParameter('triggerMode') as string;
				if (triggerMode !== 'webhook') return true;

				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookUuid) {
					try {
						await everyPageApiRequest.call(
							this,
							'DELETE',
							`/api/v1/webhooks/${staticData.webhookUuid as string}`,
						);
					} catch (error) {
						// A 404 means the subscription is already gone (deleted from the
						// dashboard) - fine. Anything else propagates, wrapped if some
						// non-API error ever lands here (the request helper only throws
						// NodeApiError).
						if (!isNotFoundApiError(error)) {
							const typedError =
								error instanceof NodeApiError
									? error
									: new NodeApiError(this.getNode(), error as JsonObject);
							throw typedError;
						}
					}
				}
				delete staticData.webhookUuid;
				delete staticData.webhookSecret;
				return true;
			},
		},
	};

	// -------------------------------------------------------------------------
	// Instant mode: delivery handling. Every delivery is verified against
	// X-Everypage-Signature ("t=<unix>,v1=<hex>", HMAC-SHA256 over
	// "<t>.<raw body>" keyed with the FULL whsec_-prefixed secret) with a
	// 5-minute timestamp tolerance and a constant-time comparison. Unverified
	// deliveries are rejected with a 401 and never reach the workflow.
	// -------------------------------------------------------------------------
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const staticData = this.getWorkflowStaticData('node');

		const secret = staticData.webhookSecret as string | undefined;
		const signature = req.headers[SIGNATURE_HEADER] as string | undefined;
		// n8n retains the raw request bytes for signature use-cases; fall back
		// to re-serialising the parsed body only if the runtime did not.
		const rawBody: Buffer | string =
			(req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(this.getBodyData());

		// Fail closed: no stored secret (static data lost) or a bad signature
		// means the delivery cannot be trusted.
		if (!secret || !verifyWebhookSignature(secret, signature, rawBody)) {
			res.status(401).send('Webhook signature verification failed');
			return { noWebhookResponse: true };
		}

		// Delivery envelope: {event, timestamp, data} where data always carries
		// fileUuid + fileName plus per-kind extras. The output shape mirrors the
		// Zapier app's instant triggers: a synthesized stable id, occurredAt,
		// then the flattened data - so downstream field mappings stay identical
		// across the automation integrations.
		const envelope = this.getBodyData() as {
			event?: string;
			timestamp?: string;
			data?: IDataObject;
		};
		const data = envelope.data ?? {};
		const item: IDataObject = {
			id: `${envelope.event}:${data.fileUuid as string}:${envelope.timestamp}`,
			event: envelope.event,
			occurredAt: envelope.timestamp,
			...data,
		};
		// Convenience copy for gate captures: the common case (email) maps in
		// one click even when the capture only stored it inside the form fields.
		if (envelope.event === 'gate.completed' && !item.email) {
			item.email = (data.fields as IDataObject | undefined)?.email;
		}

		return {
			workflowData: [this.helpers.returnJsonArray([item])],
		};
	}

	// -------------------------------------------------------------------------
	// Poll mode: cursor-aware walk over the /api/v1/events streams, mirroring
	// the Zapier app's polling dedup. Cursors are PER-TYPE (each stream has
	// its own id sequence, and gate ids are int64 - stored as strings, never
	// 32-bit-clamped) and only advance after a successful fetch that returned
	// events. Emitted ids are namespaced "<type>:<id>" so view id 42 and gate
	// id 42 can never collide downstream.
	// -------------------------------------------------------------------------
	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const triggerMode = this.getNodeParameter('triggerMode') as string;
		if (triggerMode !== 'poll') return null;

		const streams = this.getNodeParameter('pollStreams') as string[];
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const staticData = this.getWorkflowStaticData('node');
		const cursors = (staticData.pollCursors ?? {}) as Record<string, string>;
		staticData.pollCursors = cursors;

		// Manual executions fetch a small newest-first sample WITHOUT touching
		// the cursors - testing in the editor must never advance a live
		// workflow's position.
		const isManual = this.getMode() === 'manual';

		const collected: IDataObject[] = [];
		for (const stream of POLL_STREAMS) {
			if (!streams.includes(stream)) continue;

			const qs: IDataObject = {
				type: stream,
				limit: isManual ? 3 : 100,
				since: isManual ? 0 : Number(cursors[stream] ?? 0),
			};
			if (options.file) qs.file = options.file;

			const events = ((await everyPageApiRequest.call(this, 'GET', '/api/v1/events', { qs })) ??
				[]) as IDataObject[];

			if (!isManual && events.length) {
				const maxId = events.reduce(
					(max, event) => (Number(event.id) > max ? Number(event.id) : max),
					Number(cursors[stream] ?? 0),
				);
				cursors[stream] = String(maxId);
			}

			collected.push(...events.map((event) => ({ ...event, id: `${stream}:${event.id}` })));
		}

		if (!collected.length) return null;
		return [this.helpers.returnJsonArray(collected)];
	}
}
