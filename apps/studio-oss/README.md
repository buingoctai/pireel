# Editor component example

This application mounts the original `PireelEditor` with local storage adapters. Canvas, timeline, transcript, assets, properties and AI controls share the same workbench as the hosted product. Supply `StudioProviders` to connect AI services; use host extensions for product workflow pages.

Run `pnpm install` and `pnpm dev` from the open-source repository root. See the [repository README](../../README.md) for embedding and the product boundary.

## Configuration

Create `.env.local` in this directory to configure the AI service:

- `GEMINI_API_KEY`: Gemini API key (recommended)
- `GOOGLE_API_KEY`: Alternative Gemini API key
- `GOOGLE_GENERATIVE_AI_API_KEY`: Legacy Gemini API key name
- `GEMINI_MODEL`: Optional model override (defaults to `gemini-3.1-flash-lite`)

The key is resolved in priority order: `GEMINI_API_KEY` > `GOOGLE_API_KEY` > `GOOGLE_GENERATIVE_AI_API_KEY`.
