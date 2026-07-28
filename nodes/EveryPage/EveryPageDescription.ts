import type { INodeProperties } from 'n8n-workflow';

// Field definitions for the EveryPage node. Input key names are pinned to
// the EveryPage Zapier app (the reference implementation for the automation
// integrations): passcode (not password), expiryHours/neverExpire,
// blockRightClick/blockPrint/blockCopy/blurOnLeave, pageFrom/pageTo, slug,
// gateDomains, viewLimit, askReceipt, requireEmail, notifyOnView.
// Plan-gated fields say so up front in their description and link the
// upgrade page - the node's error mapping also turns the API's tier 403s
// into a friendly error, but the field should warn BEFORE the run fails.
//
// NOTE: all descriptions are plain string literals (no template
// interpolation) so the n8n-nodes-base lint autofixes stay well-defined.

const fileField = (
	operations: string[],
	resource: string,
	overrides: Partial<INodeProperties> = {},
): INodeProperties => ({
	displayName: 'Document Name or ID',
	name: 'file',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getFiles' },
	default: '',
	required: true,
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	displayOptions: { show: { resource: [resource], operation: operations } },
	...overrides,
});

// The plan-tiered settings surface shared by Upload, Import From URL, and
// Update Settings. Sorted alphabetically by display name (n8n convention).
const tieredSettingsOptions = (includeClearPasscode: boolean): INodeProperties[] => {
	const options: INodeProperties[] = [
		{
			displayName: 'Allow Downloading',
			name: 'allowDownload',
			type: 'boolean',
			default: true,
			description: 'Whether readers can save the PDF to disk',
		},
		{
			displayName: 'Ask Viewers to Confirm Receipt',
			name: 'askReceipt',
			type: 'boolean',
			default: false,
			description:
				'Whether to ask viewers to confirm receipt. Pairs with the Receipt Confirmed trigger event. Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Block Printing',
			name: 'blockPrint',
			type: 'boolean',
			default: false,
			description:
				'Whether to hide the print action and block the print shortcut. Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Block Right-Click',
			name: 'blockRightClick',
			type: 'boolean',
			default: false,
			description:
				'Whether to disable the context menu in the viewer. Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Block Text Copying',
			name: 'blockCopy',
			type: 'boolean',
			default: false,
			description:
				'Whether to disable text selection in the viewer. Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Blur When Window Loses Focus',
			name: 'blurOnLeave',
			type: 'boolean',
			default: false,
			description:
				'Whether to blur the pages whenever the viewer tab is not focused. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Email Gate Domain Allowlist',
			name: 'gateDomains',
			type: 'string',
			typeOptions: { multipleValues: true },
			default: [],
			description:
				'Only these email domains pass the gate, e.g. acme.com. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Email Me on Each Read',
			name: 'notifyOnView',
			type: 'boolean',
			default: false,
			description:
				'Whether to email you when the document is opened (throttled to one per hour). Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Expire After (Hours)',
			name: 'expiryHours',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 24,
			description:
				'Sets a fresh expiry counted from now. Plan caps: Free 7 days, Basic 365 days, Pro unlimited. Extend expiry BEFORE it lapses - a dead link cannot be revived.',
		},
		{
			displayName: 'Never Expire',
			name: 'neverExpire',
			type: 'boolean',
			default: false,
			description:
				'Whether the link never expires. Overrides "Expire After (Hours)". Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Require Email to View',
			name: 'requireEmail',
			type: 'boolean',
			default: false,
			description:
				'Whether to gate viewing behind an email address - pair with the EveryPage Trigger\'s Gate Completed event to capture the leads. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Self-Destruct After (Views)',
			name: 'viewLimit',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 0,
			description:
				'The link burns after this many views. 0 clears an existing limit. Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Share Pages From',
			name: 'pageFrom',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 0,
			description:
				'First page non-owner viewers see (1-based). Set 0 in both range fields to clear an existing range. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Share Pages To',
			name: 'pageTo',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 0,
			description:
				'Last shared page (inclusive; must be >= "Share Pages From"). Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Vanity Link Name',
			name: 'slug',
			type: 'string',
			default: '',
			description:
				'Lowercase letters, digits, and hyphens. Resolves only on your custom domain - QR codes and embeds always keep the durable short ID. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'View Passcode',
			name: 'passcode',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'A code viewers must enter to open the link. Requires the Basic plan or higher (<a href="https://everypage.co/pricing">pricing</a>).',
		},
		{
			displayName: 'Viewer Mode',
			name: 'viewerMode',
			type: 'options',
			options: [
				{ name: 'Flipbook', value: 'flipbook' },
				{ name: 'Magazine', value: 'magazine' },
				{ name: 'Standard', value: 'standard' },
				{ name: 'Swipe', value: 'swipe' },
			],
			default: 'standard',
			description: 'How readers page through the document',
		},
		{
			displayName: 'Watermark Pages',
			name: 'watermark',
			type: 'boolean',
			default: false,
			description:
				'Whether to stamp viewer pages with their identity. Requires the Pro plan (<a href="https://everypage.co/pricing">pricing</a>).',
		},
	];

	if (includeClearPasscode) {
		options.splice(6, 0, {
			displayName: 'Clear View Passcode',
			name: 'clearPasscode',
			type: 'boolean',
			default: false,
			description:
				'Whether to remove an existing passcode. Wins over "View Passcode" when both are set.',
		});
	}

	return options;
};

// ---------------------------------------------------------------------------
// File resource
// ---------------------------------------------------------------------------

export const fileOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Delete',
				value: 'delete',
				description: 'Move a document to the trash, or purge it permanently',
				action: 'Delete a document',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a document and its share links',
				action: 'Get a document',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'List your documents',
				action: 'Get many documents',
			},
			{
				name: 'Get QR Code',
				value: 'getQrCode',
				description: 'Download the tracked QR code PNG for a document',
				action: 'Get a document QR code',
			},
			{
				name: 'Get Readership',
				value: 'getReadership',
				description: "Get a document's readership analytics report",
				action: 'Get readership analytics',
			},
			{
				name: 'Import From URL',
				value: 'importFromUrl',
				description: 'Fetch a PDF from a URL and upload it as a tracked link',
				action: 'Import a PDF from a URL',
			},
			{
				name: 'Replace Content',
				value: 'replaceContent',
				description: 'Swap the PDF behind an existing link in place (Pro)',
				action: 'Replace document content',
			},
			{
				name: 'Update Settings',
				value: 'updateSettings',
				description: 'Change sharing settings on an existing document',
				action: 'Update document settings',
			},
			{
				name: 'Upload',
				value: 'upload',
				description: 'Upload a PDF and get a tracked share link',
				action: 'Upload a PDF',
			},
		],
		default: 'upload',
	},
];

export const fileFields: INodeProperties[] = [
	// ----- upload / replaceContent binary input -----
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field containing the PDF',
		displayOptions: { show: { resource: ['file'], operation: ['upload', 'replaceContent'] } },
	},
	// ----- importFromUrl -----
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/report.pdf',
		description:
			'Fetched by n8n without your EveryPage credentials, then uploaded to EveryPage as a new tracked document. The URL must serve a PDF.',
		displayOptions: { show: { resource: ['file'], operation: ['importFromUrl'] } },
	},
	// ----- shared file name -----
	// The parameter name is `filename` (not fileName): input keys are pinned to
	// the Zapier app's `filename` input; `fileName` is the OUTPUT key.
	{
		displayName: 'File Name',
		name: 'filename',
		type: 'string',
		default: '',
		description:
			'Optional display name, e.g. proposal.pdf. Defaults to the binary file name (or the URL file name).',
		displayOptions: {
			show: { resource: ['file'], operation: ['upload', 'importFromUrl', 'replaceContent'] },
		},
	},
	// ----- upload/import settings surface -----
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['file'], operation: ['upload', 'importFromUrl'] } },
		options: tieredSettingsOptions(false),
	},
	// ----- document pickers -----
	fileField(
		['get', 'updateSettings', 'delete', 'replaceContent', 'getQrCode', 'getReadership'],
		'file',
	),
	// ----- updateSettings surface -----
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		description:
			'Only the options you add are sent - everything else keeps its current value on the document',
		displayOptions: { show: { resource: ['file'], operation: ['updateSettings'] } },
		options: tieredSettingsOptions(true),
	},
	// ----- getMany -----
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['file'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['file'], operation: ['getMany'], returnAll: [false] } },
	},
	// ----- delete -----
	{
		displayName: 'Purge Permanently',
		name: 'purge',
		type: 'boolean',
		default: false,
		description:
			'Whether to permanently delete instead of moving to the trash. A trashed document can be restored from the dashboard until its purge date; a purged one is gone for good, along with its share links and readership history.',
		displayOptions: { show: { resource: ['file'], operation: ['delete'] } },
	},
	// ----- replaceContent -----
	{
		displayName: 'Keep Page-Anchored Hotspots and Notes',
		name: 'keepAnchors',
		type: 'boolean',
		default: false,
		description:
			'Whether to keep page-anchored hotspots and notes. Anchors point at pages of the OLD document, so they are cleared by default - keep them only when the new PDF has the same page layout.',
		displayOptions: { show: { resource: ['file'], operation: ['replaceContent'] } },
	},
	// ----- getQrCode -----
	{
		displayName: 'Put Output in Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		default: 'data',
		hint: 'The name of the output binary field to put the QR code PNG in',
		displayOptions: { show: { resource: ['file'], operation: ['getQrCode'] } },
	},
];

// ---------------------------------------------------------------------------
// Link Variant resource (Pro)
// ---------------------------------------------------------------------------

export const variantOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['variant'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Mint a per-recipient tracked link for a document',
				action: 'Create a link variant',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a link variant, optionally redacting its label (GDPR)',
				action: 'Delete a link variant',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: "List a document's link variants",
				action: 'Get many link variants',
			},
			{
				name: 'Revoke',
				value: 'revoke',
				description: 'Revoke a link variant so its URL stops resolving',
				action: 'Revoke a link variant',
			},
			{
				name: 'Update',
				value: 'update',
				description: "Update a link variant's label, overrides, or revocation",
				action: 'Update a link variant',
			},
		],
		default: 'create',
	},
];

export const variantFields: INodeProperties[] = [
	fileField(['create', 'delete', 'getMany', 'revoke', 'update'], 'variant'),
	{
		displayName: 'Variant UUID',
		name: 'variantUuid',
		type: 'string',
		default: '',
		required: true,
		description: 'The UUID of the link variant (from the Create or Get Many operations)',
		displayOptions: { show: { resource: ['variant'], operation: ['delete', 'revoke', 'update'] } },
	},
	// ----- create -----
	{
		displayName: 'Recipient Label',
		name: 'label',
		type: 'string',
		default: '',
		description:
			'Who this link is for, e.g. "Jane at Acme". Shown in readership and webhook payloads; erasable later via GDPR redaction.',
		displayOptions: { show: { resource: ['variant'], operation: ['create'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['variant'], operation: ['create'] } },
		options: [
			{
				displayName: 'Allow Downloading (Override)',
				name: 'allowDownload',
				type: 'boolean',
				default: true,
				description:
					'Whether readers on this link can download, overriding the file-level permission. Leave off to inherit.',
			},
			{
				displayName: 'Share Pages From (Override)',
				name: 'pageFrom',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Limit this link to a page window (1-based). Set 0 in both to serve the FULL document even when the file has a range.',
			},
			{
				displayName: 'Share Pages To (Override)',
				name: 'pageTo',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Last shared page (inclusive). Leave both unset to inherit the file-level range.',
			},
		],
	},
	// ----- update -----
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['variant'], operation: ['update'] } },
		options: [
			{
				displayName: 'Allow Downloading (Override)',
				name: 'allowDownload',
				type: 'boolean',
				default: true,
				description:
					"Whether readers on this link can download, overriding the file-level permission. WARNING: providing ANY override field REPLACES the variant's whole overrides object server-side (it never merges) - re-state every override you want to keep.",
			},
			{
				displayName: 'Recipient Label',
				name: 'label',
				type: 'string',
				default: '',
				description: 'New label for the variant. A redacted label cannot be re-set.',
			},
			{
				displayName: 'Revoked',
				name: 'revoked',
				type: 'boolean',
				default: false,
				description:
					'Whether the variant is revoked. Revoked links return a uniform 404 to viewers - note that recipients who already opened the link have learned the canonical document URL.',
			},
			{
				displayName: 'Share Pages From (Override)',
				name: 'pageFrom',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					"First page for this link (1-based); 0 in both serves the full document. WARNING: providing ANY override field REPLACES the variant's whole overrides object server-side (it never merges) - re-state every override you want to keep.",
			},
			{
				displayName: 'Share Pages To (Override)',
				name: 'pageTo',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					"Last shared page (inclusive) for this link. WARNING: providing ANY override field REPLACES the variant's whole overrides object server-side (it never merges) - re-state every override you want to keep.",
			},
		],
	},
	// ----- delete -----
	{
		displayName: 'Redact Label',
		name: 'redact',
		type: 'boolean',
		default: false,
		description:
			'Whether to redact the recipient label as part of deletion (GDPR erasure). The label is removed from readership history and cannot be re-set.',
		displayOptions: { show: { resource: ['variant'], operation: ['delete'] } },
	},
	// ----- getMany -----
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['variant'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['variant'], operation: ['getMany'], returnAll: [false] } },
	},
];

// ---------------------------------------------------------------------------
// Event resource (bulk pulls for warehouse loads; the EveryPage Trigger node
// is the right tool for firing workflows on new events)
// ---------------------------------------------------------------------------

export const eventOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['event'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Pull analytics events in bulk from the events feed',
				action: 'Get many events',
			},
		],
		default: 'getMany',
	},
];

export const eventFields: INodeProperties[] = [
	{
		displayName: 'Event Type',
		name: 'eventType',
		type: 'options',
		options: [
			{
				name: 'Download',
				value: 'download',
				description: 'Explicit PDF downloads (includes your own)',
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
		default: 'view',
		description:
			'Which event stream to pull. Each stream has its own independent ID sequence - cursors are never portable across types.',
		displayOptions: { show: { resource: ['event'], operation: ['getMany'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['event'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['event'], operation: ['getMany'], returnAll: [false] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: ['event'], operation: ['getMany'] } },
		options: [
			{
				displayName: 'Document Name or ID',
				name: 'file',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getFiles' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Since (Event ID)',
				name: 'since',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Cursor for incremental pulls: pass the highest event ID you have already processed to walk forward (ascending) from it. 0 returns the newest events first (capped at a window of 100).',
			},
		],
	},
];
