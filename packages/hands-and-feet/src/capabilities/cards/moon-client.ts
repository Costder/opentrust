import OAuth from 'oauth-1.0a';
import { createHmac } from 'crypto';

export interface MoonClientConfig {
  consumerKey: string;
  consumerSecret: string;
  sandbox: boolean;
}

export class MoonClient {
  private readonly oauth: OAuth;
  private readonly baseUrl: string;

  constructor(config: MoonClientConfig) {
    this.baseUrl = config.sandbox
      ? 'https://sandbox.api.paywithmoon.com/v1'
      : 'https://api.paywithmoon.com/v1';

    this.oauth = new OAuth({
      consumer: { key: config.consumerKey, secret: config.consumerSecret },
      signature_method: 'HMAC-SHA1',
      hash_function(baseString: string, key: string) {
        return createHmac('sha1', key).update(baseString).digest('base64');
      },
    });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestData = { url, method };
    const authHeader = this.oauth.toHeader(this.oauth.authorize(requestData));

    const response = await fetch(url, {
      method,
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Moon API ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> { return this.request('GET', path); }
  post<T>(path: string, body: unknown): Promise<T> { return this.request('POST', path, body); }
  patch<T>(path: string, body: unknown): Promise<T> { return this.request('PATCH', path, body); }
  delete<T>(path: string): Promise<T> { return this.request('DELETE', path); }
}
