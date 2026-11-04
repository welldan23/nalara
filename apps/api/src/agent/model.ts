// OpenAI-compatible chat completions with tool calling (P3-03, ADR-020). The provider is reached
// only through the safe fetch (public addresses, https, no redirects for POST, size and time
// limits). The API key travels in the Authorization header and is never logged.
import { FetchBlocked, safeFetch } from '../modules/fetch/safe-fetch.ts';
import type { SafeFetchOptions } from '../modules/fetch/safe-fetch.ts';
import type { AgentProviderConfig } from '../config/env.ts';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ToolSpec {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface ModelReply {
  readonly message: ChatMessage;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export class ModelError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`model call failed: ${code}`);
    this.name = 'ModelError';
    this.code = code;
  }
}

/** Test seams for the safe fetch (local HTTPS server); production passes nothing. */
export type ModelFetchOptions = Pick<SafeFetchOptions, 'policy' | 'resolve' | 'ca' | 'ports'>;

const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

function parseReply(body: Buffer): ModelReply {
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ModelError('model:invalid_json');
  }
  const root = json as {
    choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const message = root.choices?.[0]?.message;
  if (message === undefined) throw new ModelError('model:no_choice');
  const calls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const raw of message.tool_calls.slice(0, 8) as unknown[]) {
      const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      if (
        typeof call.id === 'string' &&
        call.id.length <= 100 &&
        typeof call.function?.name === 'string' &&
        typeof call.function.arguments === 'string'
      ) {
        calls.push({
          id: call.id,
          type: 'function',
          function: { name: call.function.name.slice(0, 100), arguments: call.function.arguments },
        });
      }
    }
  }
  return {
    message: {
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content.slice(0, 20_000) : null,
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    },
    usage: {
      inputTokens: count(root.usage?.prompt_tokens),
      outputTokens: count(root.usage?.completion_tokens),
    },
  };
}

export async function chat(
  provider: AgentProviderConfig,
  messages: readonly ChatMessage[],
  tools: readonly ToolSpec[],
  fetchOptions: ModelFetchOptions = {},
): Promise<ModelReply> {
  let response;
  try {
    response = await safeFetch(`${provider.baseUrl}/chat/completions`, {
      ...fetchOptions,
      method: 'POST',
      body: {
        model: provider.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1500,
      },
      headers: { authorization: `Bearer ${provider.apiKey}`, accept: 'application/json' },
      contentTypes: ['application/json'],
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 90_000,
      userAgent: 'NALARA-Agent/1.0',
    });
  } catch (error) {
    if (error instanceof FetchBlocked) throw new ModelError(`fetch:${error.reason}`);
    throw new ModelError('fetch:network');
  }
  if (response.status !== 200) {
    throw new ModelError(response.status === 429 ? 'model:rate_limited' : 'model:http_error');
  }
  return parseReply(response.body);
}
