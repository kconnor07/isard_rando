import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return client;
}

export const geminiProvider: LlmProvider = {
  name: 'gemini',

  isConfigured() {
    return Boolean(config.GEMINI_API_KEY);
  },

  async completeText(req: LlmRequest): Promise<LlmResponse> {
    const model =
      req.task === 'vision_check' || req.images?.length
        ? config.GEMINI_MODEL_VISION
        : config.GEMINI_MODEL_SCORING;
    const parts: Array<Record<string, unknown>> = [
      ...(req.images ?? []).map((img) => ({
        inlineData: { mimeType: img.mime, data: img.data.toString('base64') },
      })),
      { text: req.prompt },
    ];
    const response = await getClient().models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxTokens ?? 8192,
      },
    });
    const text = response.text ?? '';
    return {
      text,
      model,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  },
};
