import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

// API-key auth: the user pastes a personal ep_live_ key, which is sent as a
// bearer token on every request. The credential test hits GET /api/v1/user so
// n8n can confirm the key before the first workflow run. The base URL is
// overridable for staging/self-hosted deployments; everything defaults to
// production everypage.co.
export class EveryPageApi implements ICredentialType {
	name = 'everyPageApi';

	displayName = 'EveryPage API';

	// Resolves within dist/: the gulp icon step copies the node SVGs, and the
	// credential reuses them rather than shipping a duplicate.
	icon: Icon = {
		light: 'file:../nodes/EveryPage/everypage.svg',
		dark: 'file:../nodes/EveryPage/everypage.dark.svg',
	};

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://everypage.co/developers';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Personal API key from <a href="https://everypage.co/account">everypage.co/account</a> under API keys. It starts with <code>ep_live_</code>. Treat it like a password.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://everypage.co',
			description:
				'Override only when testing against a staging or self-hosted EveryPage deployment',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(new RegExp("/+$"), "")}}',
			url: '/api/v1/user',
		},
	};
}
