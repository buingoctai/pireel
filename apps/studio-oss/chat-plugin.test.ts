import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Connect } from 'vite';
import { chatPlugin } from './chat-plugin';
import type { ViteDevServer } from 'vite';

// Mock the AI SDK
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => 'mock-model',
}));

vi.mock('ai', () => ({
  convertToModelMessages: vi.fn(async (messages) => messages),
  jsonSchema: vi.fn((schema) => schema),
  stepCountIs: vi.fn((n) => n),
  tool: vi.fn((config) => config),
  streamText: vi.fn(),
}));

describe('chatPlugin', () => {
  let mockServer: Partial<ViteDevServer>;
  let mockReq: Partial<Connect.IncomingMessage>;
  let mockRes: any;
  let nextFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      ssrLoadModule: vi.fn(async (module: string) => {
        if (module.includes('instructions')) {
          return { AGENT_INSTRUCTIONS: 'mock instructions' };
        }
        if (module.includes('registry')) {
          return { V3_CHAT_TOOL_IDS: [], CHAT_SERVER_EXECUTED_TOOLS: new Set() };
        }
        if (module.includes('schemas')) {
          return { V3_TOOL_SCHEMAS: {} };
        }
        return {};
      }),
      middlewares: {
        use: vi.fn(),
      },
    } as any;

    mockReq = {
      url: '/api/studio/chat',
      method: 'POST',
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] })));
        }
        if (event === 'end') {
          handler();
        }
      }),
    } as any;

    mockRes = {
      statusCode: 200,
      headersSent: false,
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    nextFn = vi.fn();
  });

  it('retries on 429 error that arrives after first chunk', async () => {
    const { streamText } = await import('ai');

    let attemptCount = 0;
    (streamText as any).mockImplementation(() => {
      attemptCount++;

      // Create a mock stream that emits start chunk, then error chunk
      const encoder = new TextEncoder();
      const startChunk = encoder.encode('data: {"type":"start"}\n\n');
      const errorChunk = encoder.encode('data: {"type":"error","errorText":"429: Quota exceeded"}\n\n');

      let chunkIndex = 0;
      const mockStream = new ReadableStream({
        async pull(controller) {
          if (chunkIndex === 0) {
            controller.enqueue(startChunk);
            chunkIndex++;
          } else if (chunkIndex === 1) {
            controller.enqueue(errorChunk);
            chunkIndex++;
          } else {
            controller.close();
          }
        },
      });

      return {
        toUIMessageStreamResponse: () => ({
          status: 200,
          headers: new Map([['content-type', 'text/event-stream']]),
          body: mockStream,
        }),
      };
    });

    const plugin = chatPlugin({ apiKey: 'test-key', model: 'test-model' });
    plugin.configureServer!(mockServer as ViteDevServer);

    // Get the middleware handler
    const middlewareHandler = (mockServer.middlewares!.use as any).mock.calls[0][0];

    await middlewareHandler(mockReq, mockRes, nextFn);

    // Should have retried 3 times
    expect(attemptCount).toBe(3);

    // Should return 429 with friendly message
    expect(mockRes.statusCode).toBe(429);
    expect(mockRes.end).toHaveBeenCalled();
    const endCall = (mockRes.end as any).mock.calls[0][0];
    const response = JSON.parse(endCall);
    expect(response.error).toContain('AI is busy');
    expect(response.error).toContain('free-tier limit reached');
  });

  it('succeeds on second retry after 429', async () => {
    const { streamText } = await import('ai');

    let attemptCount = 0;
    (streamText as any).mockImplementation(() => {
      attemptCount++;

      const encoder = new TextEncoder();

      // First attempt: error after start chunk
      if (attemptCount === 1) {
        const startChunk = encoder.encode('data: {"type":"start"}\n\n');
        const errorChunk = encoder.encode('data: {"type":"error","errorText":"429: Quota exceeded"}\n\n');

        let chunkIndex = 0;
        return {
          toUIMessageStreamResponse: () => ({
            status: 200,
            headers: new Map([['content-type', 'text/event-stream']]),
            body: new ReadableStream({
              async pull(controller) {
                if (chunkIndex === 0) {
                  controller.enqueue(startChunk);
                  chunkIndex++;
                } else if (chunkIndex === 1) {
                  controller.enqueue(errorChunk);
                  chunkIndex++;
                } else {
                  controller.close();
                }
              },
            }),
          }),
        };
      }

      // Second attempt: success
      const startChunk = encoder.encode('data: {"type":"start"}\n\n');
      const textChunk = encoder.encode('data: {"type":"text-delta","textDelta":"Hello"}\n\n');

      let chunkIndex = 0;
      return {
        toUIMessageStreamResponse: () => ({
          status: 200,
          headers: new Map([['content-type', 'text/event-stream']]),
          body: new ReadableStream({
            async pull(controller) {
              if (chunkIndex === 0) {
                controller.enqueue(startChunk);
                chunkIndex++;
              } else if (chunkIndex === 1) {
                controller.enqueue(textChunk);
                chunkIndex++;
              } else {
                controller.close();
              }
            },
          }),
        }),
      };
    });

    const plugin = chatPlugin({ apiKey: 'test-key', model: 'test-model' });
    plugin.configureServer!(mockServer as ViteDevServer);

    const middlewareHandler = (mockServer.middlewares!.use as any).mock.calls[0][0];

    await middlewareHandler(mockReq, mockRes, nextFn);

    // Should have retried once
    expect(attemptCount).toBe(2);

    // Should succeed with 200
    expect(mockRes.statusCode).toBe(200);

    // Should have written both chunks
    expect(mockRes.write).toHaveBeenCalledTimes(2);
    expect(mockRes.end).toHaveBeenCalled();
  });

  it('does not retry on non-quota errors', async () => {
    const { streamText } = await import('ai');

    let attemptCount = 0;
    (streamText as any).mockImplementation(() => {
      attemptCount++;

      const encoder = new TextEncoder();
      const startChunk = encoder.encode('data: {"type":"start"}\n\n');
      const errorChunk = encoder.encode('data: {"type":"error","errorText":"Invalid input"}\n\n');

      let chunkIndex = 0;
      return {
        toUIMessageStreamResponse: () => ({
          status: 200,
          headers: new Map([['content-type', 'text/event-stream']]),
          body: new ReadableStream({
            async pull(controller) {
              if (chunkIndex === 0) {
                controller.enqueue(startChunk);
                chunkIndex++;
              } else if (chunkIndex === 1) {
                controller.enqueue(errorChunk);
                chunkIndex++;
              } else {
                controller.close();
              }
            },
          }),
        }),
      };
    });

    const plugin = chatPlugin({ apiKey: 'test-key', model: 'test-model' });
    plugin.configureServer!(mockServer as ViteDevServer);

    const middlewareHandler = (mockServer.middlewares!.use as any).mock.calls[0][0];

    await middlewareHandler(mockReq, mockRes, nextFn);

    // Should NOT retry on non-quota errors
    expect(attemptCount).toBe(1);

    // Should return 500
    expect(mockRes.statusCode).toBe(500);
  });
});
