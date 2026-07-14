/**
 * OpenAI chat plumbing for the main process: request construction and SSE
 * stream parsing, kept pure so they unit-test without a network. main.js owns
 * the fetch loop, the API key, and the IPC surface.
 */

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_MODEL = 'gpt-5-mini';

/** fetch() init for a streaming chat completion. */
export function chatRequestInit(apiKey, model, messages) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  };
}

/**
 * Incremental SSE parser for the completion stream. Feed it decoded text
 * chunks as they arrive; each call returns the content deltas completed by
 * that chunk and whether the [DONE] sentinel was seen. Partial events stay
 * buffered; junk lines and keepalive comments are ignored.
 */
export function createDeltaParser() {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    const out = { deltas: [], done: false };
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          out.done = true;
          continue;
        }
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) out.deltas.push(delta);
        } catch {
          /* partial or non-JSON payload — skip */
        }
      }
    }
    return out;
  };
}
