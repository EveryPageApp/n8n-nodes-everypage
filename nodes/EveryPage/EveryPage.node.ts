import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import type { NodeConnectionType } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	buildMultipartBody,
	everyPageApiRequest,
	getBaseUrl,
	isPdf,
	settingsFromOptions,
	shareTrio,
	throwNoPdf,
	variantOverridesFromOptions,
} from './GenericFunctions';
import {
	eventFields,
	eventOperations,
	fileFields,
	fileOperations,
	variantFields,
	variantOperations,
} from './EveryPageDescription';

const EVENTS_PAGE_SIZE = 100; // the API clamps ?limit to 1-100

export class EveryPage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EveryPage',
		name: 'everyPage',
		icon: { light: 'file:everypage.svg', dark: 'file:everypage.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Share PDFs as tracked links with page-by-page reader analytics - upload, gate, watermark, and pull readership from EveryPage',
		defaults: { name: 'EveryPage' },
		usableAsTool: true,
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [{ name: 'everyPageApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Event', value: 'event' },
					{ name: 'File', value: 'file' },
					{ name: 'Link Variant', value: 'variant' },
				],
				default: 'file',
			},
			...fileOperations,
			...fileFields,
			...variantOperations,
			...variantFields,
			...eventOperations,
			...eventFields,
		],
	};

	methods = {
		loadOptions: {
			// The document picker: every dropdown value is the UUID (the durable
			// identifier the whole API keys off), labelled by name + short ID.
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const baseUrl = await getBaseUrl.call(this);

		// Upload the given bytes as a new document and apply any settings.
		// Returns the Zapier-app-compatible output shape.
		const uploadBuffer = async (
			i: number,
			buffer: Buffer,
			fileName: string,
		): Promise<IDataObject> => {
			const { body, contentType } = buildMultipartBody('file', fileName, buffer);
			const upload = (await everyPageApiRequest.call(this, 'POST', '/api/v1/files', {
				body,
				headers: { 'Content-Type': contentType },
			})) as IDataObject;
			const uuid = upload.uuid as string;
			const shortId = upload.shortId as string | undefined;

			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const settings = settingsFromOptions(options);
			if (Object.keys(settings).length) {
				await everyPageApiRequest.call(this, 'PUT', `/api/v1/files/${uuid}/settings`, {
					body: settings,
				});
			}

			return { uuid, shortId, fileName, ...shareTrio(baseUrl, uuid, shortId) };
		};

		const decorateFile = (file: IDataObject): IDataObject => ({
			...file,
			...shareTrio(baseUrl, file.uuid as string, file.shortId as string | undefined),
		});

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};
				let binaryOut: INodeExecutionData | undefined;

				if (resource === 'file') {
					if (operation === 'upload') {
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const binaryMetadata = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
						if (!isPdf(buffer)) throwNoPdf(this.getNode(), 'The input binary data');
						const fileName =
							(this.getNodeParameter('filename', i, '') as string) ||
							binaryMetadata.fileName ||
							'document.pdf';
						responseData = await uploadBuffer(i, buffer, fileName);
					} else if (operation === 'importFromUrl') {
						// The API's own /files/import endpoint is SSRF-allowlisted to
						// Canva only, so the node fetches the bytes itself (WITHOUT the
						// EveryPage credentials - the key must never travel to a
						// user-supplied host) and re-uploads them as multipart.
						const url = this.getNodeParameter('url', i) as string;
						const download = await this.helpers.httpRequest({
							url,
							method: 'GET',
							encoding: 'arraybuffer',
							returnFullResponse: true,
						});
						const buffer = Buffer.isBuffer(download.body)
							? download.body
							: Buffer.from(download.body as ArrayBuffer);
						if (!isPdf(buffer)) throwNoPdf(this.getNode(), `The file at ${url}`);
						const urlName = decodeURIComponent(
							(new URL(url).pathname.split('/').pop() || '').trim(),
						);
						const fileName =
							(this.getNodeParameter('filename', i, '') as string) ||
							(urlName.toLowerCase().endsWith('.pdf') ? urlName : '') ||
							'document.pdf';
						responseData = await uploadBuffer(i, buffer, fileName);
					} else if (operation === 'get') {
						const fileId = this.getNodeParameter('file', i) as string;
						const file = (await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${fileId}`,
						)) as IDataObject;
						responseData = decorateFile(file);
					} else if (operation === 'getMany') {
						// The upstream list is unpaginated (all active files, newest
						// first), so limiting is client-side slicing.
						const files = ((await everyPageApiRequest.call(this, 'GET', '/api/v1/files')) ??
							[]) as IDataObject[];
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const sliced = returnAll
							? files
							: files.slice(0, this.getNodeParameter('limit', i) as number);
						responseData = sliced.map(decorateFile);
					} else if (operation === 'updateSettings') {
						const fileId = this.getNodeParameter('file', i) as string;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const settings = settingsFromOptions(options);
						await everyPageApiRequest.call(this, 'PUT', `/api/v1/files/${fileId}/settings`, {
							body: settings,
						});
						// The PUT returns an empty 200; re-GET so the output carries the
						// document's actual post-update state.
						const file = (await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${fileId}`,
						)) as IDataObject;
						responseData = decorateFile(file);
					} else if (operation === 'delete') {
						const fileId = this.getNodeParameter('file', i) as string;
						const purge = this.getNodeParameter('purge', i) as boolean;
						const qs: IDataObject = {};
						if (purge) qs.purge = '1';
						const result = (await everyPageApiRequest.call(
							this,
							'DELETE',
							`/api/v1/files/${fileId}`,
							{ qs },
						)) as IDataObject | undefined;
						// Soft delete returns the trash receipt {trashed, trashedAt,
						// purgeAt}; surface it so workflows can log the restore window.
						responseData = purge
							? { uuid: fileId, deleted: true, ...(result ?? {}) }
							: { uuid: fileId, ...(result ?? { trashed: true }) };
					} else if (operation === 'replaceContent') {
						const fileId = this.getNodeParameter('file', i) as string;
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const binaryMetadata = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
						if (!isPdf(buffer)) throwNoPdf(this.getNode(), 'The input binary data');
						const fileName =
							(this.getNodeParameter('filename', i, '') as string) ||
							binaryMetadata.fileName ||
							'document.pdf';
						const keepAnchors = this.getNodeParameter('keepAnchors', i) as boolean;
						const qs: IDataObject = {};
						// The server clears page anchors by default (they point at pages of
						// the OLD document), so the node sends the explicit
						// clearAnchors=false only when the user opts to keep them.
						if (keepAnchors) qs.clearAnchors = 'false';
						const { body, contentType } = buildMultipartBody('file', fileName, buffer);
						const replaceResult = (await everyPageApiRequest.call(
							this,
							'POST',
							`/api/v1/files/${fileId}/content`,
							{ body, headers: { 'Content-Type': contentType }, qs },
						)) as IDataObject | undefined;
						const file = (await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${fileId}`,
						)) as IDataObject;
						responseData = {
							uuid: file.uuid,
							shortId: file.shortId,
							contentVersion: file.contentVersion ?? replaceResult?.contentVersion,
							...shareTrio(baseUrl, file.uuid as string, file.shortId as string | undefined),
						};
					} else if (operation === 'getQrCode') {
						const fileId = this.getNodeParameter('file', i) as string;
						const outputBinaryPropertyName = this.getNodeParameter(
							'outputBinaryPropertyName',
							i,
						) as string;
						// Resolve the durable identifiers first so the output filename
						// and json fields are exact whichever ID the input used.
						const file = (await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${fileId}`,
						)) as IDataObject;
						const uuid = file.uuid as string;
						const shortId = (file.shortId as string | undefined) || uuid;
						const png = (await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${uuid}/qr-code`,
							{ binary: true },
						)) as Buffer;
						const qrFileName = `everypage-${shortId}-qr.png`;
						binaryOut = {
							json: {
								uuid,
								shortId,
								fileName: qrFileName,
								qr_url: `${baseUrl}/api/files/${uuid}/qr-code`,
							},
							binary: {
								[outputBinaryPropertyName]: await this.helpers.prepareBinaryData(
									png,
									qrFileName,
									'image/png',
								),
							},
							pairedItem: { item: i },
						};
					} else if (operation === 'getReadership') {
						const fileId = this.getNodeParameter('file', i) as string;
						// Plan-shaped aggregates: sections above the caller's tier are
						// omitted entirely; the `tier` field says which. Passed through
						// as-is.
						responseData = (await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${fileId}/readership`,
						)) as IDataObject;
					}
				} else if (resource === 'variant') {
					const fileId = this.getNodeParameter('file', i) as string;

					if (operation === 'create') {
						const label = this.getNodeParameter('label', i, '') as string;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const body: IDataObject = {};
						if (label) body.label = label;
						const overrides = variantOverridesFromOptions(options);
						if (overrides) body.overrides = overrides;
						const variant = (await everyPageApiRequest.call(
							this,
							'POST',
							`/api/v1/files/${fileId}/variants`,
							{ body },
						)) as IDataObject;
						responseData = {
							uuid: variant.uuid,
							shortId: variant.shortId,
							url: variant.url,
							label: variant.label,
							createdAt: variant.createdAt,
							parentUuid: fileId,
							parentShareUrl: `${baseUrl}/${fileId}`,
						};
					} else if (operation === 'getMany') {
						const variants = ((await everyPageApiRequest.call(
							this,
							'GET',
							`/api/v1/files/${fileId}/variants`,
						)) ?? []) as IDataObject[];
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const sliced = returnAll
							? variants
							: variants.slice(0, this.getNodeParameter('limit', i) as number);
						responseData = sliced.map((variant) => ({ ...variant, parentUuid: fileId }));
					} else if (operation === 'update') {
						const variantUuid = this.getNodeParameter('variantUuid', i) as string;
						const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						const body: IDataObject = {};
						if (updateFields.label !== undefined && updateFields.label !== '') {
							body.label = updateFields.label;
						}
						if (updateFields.revoked !== undefined) body.revoked = updateFields.revoked;
						// overrides REPLACES the whole object server-side - only sent
						// when the user provided at least one override field.
						const overrides = variantOverridesFromOptions(updateFields);
						if (overrides) body.overrides = overrides;
						if (!Object.keys(body).length) {
							throw new NodeOperationError(this.getNode(), 'No update fields provided', {
								itemIndex: i,
							});
						}
						const variant = (await everyPageApiRequest.call(
							this,
							'PUT',
							`/api/v1/files/${fileId}/variants/${variantUuid}`,
							{ body },
						)) as IDataObject | undefined;
						responseData = { ...(variant ?? { uuid: variantUuid }), parentUuid: fileId };
					} else if (operation === 'revoke') {
						const variantUuid = this.getNodeParameter('variantUuid', i) as string;
						const variant = (await everyPageApiRequest.call(
							this,
							'PUT',
							`/api/v1/files/${fileId}/variants/${variantUuid}`,
							{ body: { revoked: true } },
						)) as IDataObject | undefined;
						responseData = {
							...(variant ?? { uuid: variantUuid, revoked: true }),
							parentUuid: fileId,
						};
					} else if (operation === 'delete') {
						const variantUuid = this.getNodeParameter('variantUuid', i) as string;
						const redact = this.getNodeParameter('redact', i) as boolean;
						const qs: IDataObject = {};
						if (redact) qs.redact = '1';
						await everyPageApiRequest.call(
							this,
							'DELETE',
							`/api/v1/files/${fileId}/variants/${variantUuid}`,
							{ qs },
						);
						// Redact is an IN-PLACE label scrub, not a deletion: the variant
						// (and its anonymised readership) survives. Only the plain path
						// removes it. The output must not overstate what happened.
						responseData = {
							uuid: variantUuid,
							deleted: !redact,
							redacted: redact,
							parentUuid: fileId,
						};
					}
				} else if (resource === 'event') {
					// Bulk pull over /api/v1/events for warehouse loads. Cursors are
					// per-type (view/download/gate id sequences are independent; gate
					// ids are int64 - never 32-bit-clamped here). since=0 returns the
					// newest window (descending); since>0 walks forward from the
					// cursor in ascending order, which is what incremental loads use.
					const eventType = this.getNodeParameter('eventType', i) as string;
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					const since = Number(options.since ?? 0);

					const qs: IDataObject = { type: eventType };
					if (options.file) qs.file = options.file;

					const events: IDataObject[] = [];
					if (since === 0) {
						// Newest-first window; the API caps it at 100 and there is no
						// way to page further back. Full-history walks pass a cursor.
						qs.limit = Math.min(
							Number.isFinite(limit) ? (limit as number) : EVENTS_PAGE_SIZE,
							EVENTS_PAGE_SIZE,
						);
						qs.since = 0;
						const page = ((await everyPageApiRequest.call(this, 'GET', '/api/v1/events', { qs })) ??
							[]) as IDataObject[];
						events.push(...page);
					} else {
						let cursor = since;
						for (;;) {
							const pageQs: IDataObject = { ...qs, since: cursor, limit: EVENTS_PAGE_SIZE };
							const page = ((await everyPageApiRequest.call(this, 'GET', '/api/v1/events', {
								qs: pageQs,
							})) ?? []) as IDataObject[];
							if (!page.length) break;
							events.push(...page);
							cursor = page.reduce(
								(max, event) => (Number(event.id) > max ? Number(event.id) : max),
								cursor,
							);
							if (events.length >= limit || page.length < EVENTS_PAGE_SIZE) break;
						}
					}
					responseData = Number.isFinite(limit) ? events.slice(0, limit as number) : events;
				}

				if (binaryOut) {
					returnData.push(binaryOut);
				} else if (Array.isArray(responseData)) {
					for (const entry of responseData) {
						returnData.push({ json: entry, pairedItem: { item: i } });
					}
				} else {
					returnData.push({ json: responseData, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// everyPageApiRequest already throws NodeApiError; anything else
				// (coding bugs, binary handling) gets wrapped so the raw error
				// never crosses the node boundary.
				const typedError =
					error instanceof NodeOperationError || error instanceof NodeApiError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw typedError;
			}
		}

		return [returnData];
	}
}
