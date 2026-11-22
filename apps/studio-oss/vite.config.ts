import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { localAssets } from './local-assets-plugin';
import { chatPlugin } from './chat-plugin';

/** Resolve Gemini API key from env vars in priority order */
export function resolveGeminiKey(env: Record<string, string | undefined>): string | undefined {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const geminiKey = resolveGeminiKey({ ...process.env, ...env });

  return {
    cacheDir: "node_modules/.vite-oss",
    // Workspace packages export TS source. Native Vite tsconfig resolution follows
    // each importer to the app or workspace tsconfig, so aliases work in both scopes.
    resolve: { tsconfigPaths: true },
    // localAssets: disk-backed uploads (the local counterpart of the hosted R2+CDN provider).
    // chatPlugin: /api/studio/chat backed by Gemini (key and model come from .env.local).
    plugins: [react(), tailwindcss(), localAssets(), chatPlugin({ apiKey: geminiKey, model: env.GEMINI_MODEL })],
  };
});
