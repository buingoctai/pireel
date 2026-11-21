import type { Connect, Plugin } from 'vite';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { convertToModelMessages, jsonSchema, stepCountIs, streamText, tool, type UIMessage } from 'ai';

const DEFAULT_MODEL = 'gemini-flash-latest';

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function chatPlugin({ apiKey, model }: { apiKey?: string; model?: string }): Plugin {
  // Defer studio-engine imports to avoid Node ESM resolution during vite.config.ts load
  let tools: Record<string, ReturnType<typeof tool>> | null = null;

  async function getTools() {
    if (tools) return tools;

    const [{ V3_CHAT_TOOL_IDS, CHAT_SERVER_EXECUTED_TOOLS }, { V3_TOOL_SCHEMAS }] = await Promise.all([
      import('@pireel/studio-engine/agent-surface-v3/registry'),
      import('@pireel/studio-engine/agent-surface-v3/schemas'),
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

          const { AGENT_INSTRUCTIONS } = await import('@pireel/studio-engine/agent-surface-v3/instructions');

          const google = createGoogleGenerativeAI({ apiKey });
          const result = streamText({
            model: google(model || DEFAULT_MODEL),
            system: AGENT_INSTRUCTIONS,
            messages: await convertToModelMessages(messages),
            tools: await getTools(),
            stopWhen: stepCountIs(10), // AI SDK v6: use stopWhen instead of maxSteps
          });

          const response = result.toUIMessageStreamResponse();
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));

          const reader = response.body!.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } finally {
            res.end();
          }
        } catch (e) {
          if (res.headersSent) return void res.end();
          sendJson(res, 500, { error: e instanceof Error ? e.message : 'chat failed' });
        }
      });
    },
  };
}
