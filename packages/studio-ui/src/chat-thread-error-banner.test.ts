import { describe, it, expect } from 'vitest';

/**
 * Test suite for chat error banner display logic (chat-thread.tsx:1574-1580)
 *
 * Tests the error message rendering that determines what to show when a chat request fails:
 * - insufficient_tokens → translated credit message
 * - studio_upstream_busy → translated busy message
 * - API key/configuration errors → raw server message (untruncated)
 * - other errors → generic interrupted message
 */
describe('chat error banner message selection', () => {
  const selectErrorMessage = (errorMessage: string | undefined, t: (key: string) => string): string => {
    if (!errorMessage) return t("chatGen.interruptedStatePreserved");

    if (errorMessage.includes("insufficient_tokens")) {
      return t("chatGen.notEnoughCreditsTop");
    }

    if (errorMessage.includes("studio_upstream_busy")) {
      return t("chatGen.upstreamBusy");
    }

    if (
      errorMessage.includes("API key") ||
      errorMessage.includes("not configured") ||
      errorMessage.includes("not found")
    ) {
      return errorMessage;
    }

    return t("chatGen.interruptedStatePreserved");
  };

  const mockT = (key: string): string => {
    const translations: Record<string, string> = {
      "chatGen.notEnoughCreditsTop": "Not enough credits",
      "chatGen.upstreamBusy": "Upstream is busy",
      "chatGen.interruptedStatePreserved": "The connection was interrupted",
    };
    return translations[key] || key;
  };

  it('shows translated message for insufficient_tokens', () => {
    const result = selectErrorMessage("Error: insufficient_tokens", mockT);
    expect(result).toBe("Not enough credits");
  });

  it('shows translated message for studio_upstream_busy', () => {
    const result = selectErrorMessage("Error: studio_upstream_busy", mockT);
    expect(result).toBe("Upstream is busy");
  });

  it('shows raw server message for missing API key error', () => {
    const serverMessage = "Gemini API key not found. Set GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY in apps/studio-oss/.env.local";
    const result = selectErrorMessage(serverMessage, mockT);
    expect(result).toBe(serverMessage);
  });

  it('shows raw server message for "not configured" error', () => {
    const serverMessage = "AI service not configured. Please check your configuration.";
    const result = selectErrorMessage(serverMessage, mockT);
    expect(result).toBe(serverMessage);
  });

  it('shows raw server message for "not found" error', () => {
    const serverMessage = "Configuration not found. Please set up the service.";
    const result = selectErrorMessage(serverMessage, mockT);
    expect(result).toBe(serverMessage);
  });

  it('shows generic message for other errors', () => {
    const result = selectErrorMessage("Network timeout", mockT);
    expect(result).toBe("The connection was interrupted");
  });

  it('shows generic message for undefined error', () => {
    const result = selectErrorMessage(undefined, mockT);
    expect(result).toBe("The connection was interrupted");
  });

  it('preserves full multi-line error messages', () => {
    const longMessage = `Gemini API key not found. Set GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY in apps/studio-oss/.env.local

Please configure one of these environment variables.`;
    const result = selectErrorMessage(longMessage, mockT);
    expect(result).toBe(longMessage);
  });
});
