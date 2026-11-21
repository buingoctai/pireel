import type { Connect, Plugin } from 'vite';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';

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

          const google = createGoogleGenerativeAI({ apiKey });
          const result = streamText({
            model: google(model || DEFAULT_MODEL),
            messages: await convertToModelMessages(messages),
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
