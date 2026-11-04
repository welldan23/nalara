// The runner's only way into NALARA: the agent tool gateway on the internal network (P3-03,
// ADR-020). No redirects are followed and every answer is bounded.
export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`gateway refused: ${code}`);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

export interface Gateway {
  status(role: string): Promise<GatewayStatus>;
  call(role: string, tool: string, input: unknown): Promise<unknown>;
}

export interface GatewayStatus {
  readonly aiEnabled: boolean;
  readonly quotas: Record<string, { readonly used: number; readonly limit: number }>;
}

const MAX_ANSWER = 1024 * 1024;

export function gatewayClient(baseUrl: string, token: string): Gateway {
  async function send(role: string, method: 'GET' | 'POST', path: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/agent${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${token}`,
          'x-agent-role': role,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new GatewayError(0, 'gateway:unreachable');
    }
    const text = await response.text();
    if (text.length > MAX_ANSWER) throw new GatewayError(response.status, 'gateway:too_large');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GatewayError(response.status, 'gateway:invalid_json');
    }
    if (!response.ok) {
      const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
      throw new GatewayError(response.status, typeof code === 'string' ? code : 'gateway:error');
    }
    return json;
  }
  return {
    status: async (role) => (await send(role, 'GET', '/status')) as GatewayStatus,
    call: (role, tool, input) =>
      send(role, 'POST', `/tools/${encodeURIComponent(tool)}`, input ?? {}),
  };
}
