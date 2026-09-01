import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export const anthropicProvider: LlmProvider = {
  name: 'anthropic',

  isConfigured() {
    return Boolean(config.ANTHROPIC_API_KEY);
  },

  async completeText(req: LlmRequest): Promise<LlmResponse> {
    const model = req.tier === 'best' ? config.ANTHROPIC_MODEL_WRITER : config.ANTHROPIC_MODEL_FAST;
    const content: Anthropic.ContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.ImageBlockParam => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.data.toString('base64') },
        }),
      ),
      { type: 'text', text: req.prompt },
    ];
    const response = await getClient().messages.create({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return {
      text,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  },
};
