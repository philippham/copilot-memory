import * as assert from 'assert';
import { OllamaClient } from '../ollamaClient';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function stubFetch(handler: FetchLike): void {
  const g = global as unknown as Record<string, unknown>;
  const original = g.fetch;
  suiteSetup(() => { g.fetch = handler; });
  suiteTeardown(() => { g.fetch = original; });
}

const client = new OllamaClient({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });

suite('OllamaClient.isAvailable', () => {
  suite('when Ollama responds OK', () => {
    stubFetch(async () => ({ ok: true, json: async () => ({}) }));

    test('returns true', async () => {
      assert.strictEqual(await client.isAvailable(), true);
    });
  });

  suite('when Ollama returns non-OK status', () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));

    test('returns false', async () => {
      assert.strictEqual(await client.isAvailable(), false);
    });
  });

  suite('when Ollama is unreachable', () => {
    const g = global as unknown as Record<string, unknown>;
    suiteSetup(() => { g.fetch = async () => { throw new Error('Connection refused'); }; });
    suiteTeardown(() => { delete g.fetch; });

    test('returns false without throwing', async () => {
      assert.strictEqual(await client.isAvailable(), false);
    });
  });
});

suite('OllamaClient.embed', () => {
  const embedding = [0.1, 0.2, 0.3];

  suite('when Ollama returns a valid embedding', () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ embedding })
    }));

    test('returns the embedding array', async () => {
      const result = await client.embed('factory pattern');
      assert.deepStrictEqual(result, embedding);
    });
  });

  suite('when Ollama returns non-OK status', () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));

    test('throws an error', async () => {
      await assert.rejects(() => client.embed('factory pattern'), /Ollama embed failed/);
    });
  });
});
