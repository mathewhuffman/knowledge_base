export interface ZendeskCredentials {
  subdomain: string;
  email: string;
  apiToken: string;
}

export interface ZendeskClientConfig {
  timeoutMs: number;
}

export class ZendeskClient {
  constructor(private readonly _config: ZendeskClientConfig) {}

  isConfigured(): boolean {
    return Boolean(_config?.timeoutMs);
  }
}
