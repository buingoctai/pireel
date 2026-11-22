import type { Connect, Plugin } from 'vite';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { convertToModelMessages, jsonSchema, stepCountIs, streamText, tool, type UIMessage } from 'ai';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Check statusCode from APICallError
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as any).statusCode;
    if (statusCode === 429 || statusCode === 503) return true;
  }

  const msg = error.message.toLowerCase();
  return msg.includes('429') ||
         msg.includes('resource_exhausted') ||
         msg.includes('503') ||
         msg.includes('quota');
}

function getRetryDelayMs(error: unknown, attempt: number): number {
  // Check for Retry-After header or retryDelay in error
  if (error && typeof error === 'object' && 'retryAfter' in error && typeof error.retryAfter === 'number') {
    return error.retryAfter * 1000;
  }
  // Exponential backoff with jitter: 1s, 2s, 4s base, plus random jitter
  const baseDelay = Math.min(1000 * Math.pow(2, attempt), 4000);
  const jitter = Math.random() * 1000;
  return baseDelay + jitter;
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function chatPlugin({ apiKey, model }: { apiKey?: string; model?: string }): Plugin {
  // Defer studio-engine imports to avoid Node ESM resolution during vite.config.ts load
  let tools: Record<string, ReturnType<typeof tool>> | null = null;

  async function getTools(server: import('vite').ViteDevServer) {
    if (tools) return tools;

    const [{ V3_CHAT_TOOL_IDS, CHAT_SERVER_EXECUTED_TOOLS }, { V3_TOOL_SCHEMAS }] = await Promise.all([
      server.ssrLoadModule('@pireel/studio-engine/agent-surface-v3/registry'),
      server.ssrLoadModule('@pireel/studio-engine/agent-surface-v3/schemas'),
    ]);

    tools = {};
    for (const toolId of V3_CHAT_TOOL_IDS) {
      if (CHAT_SERVER_EXECUTED_TOOLS.has(toolId)) continue;
      const schema = V3_TOOL_SCHEMAS[toolId];
      if (schema) {
        tools[toolId] = tool({
          description: schema.description,
          inputSchema: jsonSchema(schema.inputSchema),
        });
      }
    }
    return tools;
  }

  return {
    name: 'pireel-chat',
    configureServer(server) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res, next) => {
        if (req.url !== '/api/studio/chat' || req.method !== 'POST') return next();

        if (!apiKey) {
          return sendJson(res, 500, { error: 'GOOGLE_GENERATIVE_AI_API_KEY is not set in apps/studio-oss/.env.local' });
        }

        try {
          // The chat transport posts UIMessages (parts-based), and expects the UI message stream back.
          const { messages } = JSON.parse((await readBody(req)).toString('utf8')) as { messages: UIMessage[] };

          const { AGENT_INSTRUCTIONS } = await server.ssrLoadModule('@pireel/studio-engine/agent-surface-v3/instructions');

          const google = createGoogleGenerativeAI({ apiKey });

          // Retry logic for quota errors (429/503/RESOURCE_EXHAUSTED)
          const MAX_RETRIES = 3;
          let lastError: unknown;

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            let streamError: unknown = null;

            try {
              const result = streamText({
                model: google(model || DEFAULT_MODEL),
                system: AGENT_INSTRUCTIONS,
                messages: await convertToModelMessages(messages),
                tools: await getTools(server),
                stopWhen: stepCountIs(10), // AI SDK v6: use stopWhen instead of maxSteps
                onError: (error) => {
                  // Capture streaming errors before they reach the response
                  streamError = error;
                },
              });

              const response = result.toUIMessageStreamResponse();

              // Buffer chunks until we see a non-"start" chunk to detect errors before committing headers
              const reader = response.body!.getReader();
              const bufferedChunks: Uint8Array[] = [];
              let errorDetected: unknown = null;

              // Read chunks until we find a non-"start" chunk or error
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                if (chunk.value) {
                  bufferedChunks.push(chunk.value);
                  const text = new TextDecoder().decode(chunk.value);

                  // Check for error in this chunk
                  if (text.includes('"type":"error"')) {
                    // Parse to extract error details
                    const lines = text.split('\n');
                    for (const line of lines) {
                      if (line.startsWith('data: ')) {
                        try {
                          const parsed = JSON.parse(line.slice(6));
                          if (parsed.type === 'error') {
                            errorDetected = new Error(parsed.errorText || 'Stream error');
                            break;
                          }
                        } catch {}
                      }
                    }
                  }

                  // Also check onError callback
                  if (streamError) {
                    errorDetected = streamError;
                  }

                  // If we found an error, check if it's retryable
                  if (errorDetected) {
                    if (isQuotaError(errorDetected) && attempt < MAX_RETRIES - 1) {
                      const delayMs = getRetryDelayMs(errorDetected, attempt);
                      console.warn(`[pireel-chat] Quota error on attempt ${attempt + 1}, retrying in ${Math.round(delayMs)}ms...`);
                      await sleep(delayMs);
                      break; // Exit chunk-reading loop to retry
                    }
                    throw errorDetected;
                  }

                  // Check if this is a non-"start" chunk - if so, we can commit
                  if (!text.includes('"type":"start"')) {
                    break; // Exit chunk-reading loop, commit to response
                  }
                }
              }

              // If we detected a retryable error, continue to next retry attempt
              if (errorDetected && isQuotaError(errorDetected) && attempt < MAX_RETRIES - 1) {
                continue;
              }

              // No retryable error detected - commit to response and stream
              res.statusCode = response.status;
              response.headers.forEach((value, key) => res.setHeader(key, value));

              // Write all buffered chunks
              for (const chunk of bufferedChunks) {
                res.write(chunk);
              }

              // Stream remaining chunks
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
              } finally {
                res.end();
              }
              return; // Success - exit retry loop
            } catch (e) {
              lastError = e;

              // Only retry on quota errors
              if (!isQuotaError(e) || attempt === MAX_RETRIES - 1) {
                throw e;
              }

              const delayMs = getRetryDelayMs(e, attempt);
              console.warn(`[pireel-chat] Quota error on attempt ${attempt + 1}, retrying in ${Math.round(delayMs)}ms...`);
              await sleep(delayMs);
            }
          }

          // All retries exhausted
          throw lastError;
        } catch (e) {
          if (res.headersSent) return void res.end();

          // User-friendly quota error message
          if (isQuotaError(e)) {
            const retrySeconds = Math.ceil(getRetryDelayMs(e, 2) / 1000);
            sendJson(res, 429, {
              error: `AI is busy — free-tier limit reached, please try again in ~${retrySeconds} seconds`
            });
          } else {
            sendJson(res, 500, { error: e instanceof Error ? e.message : 'chat failed' });
          }
        }
      });
    },
  };
}
