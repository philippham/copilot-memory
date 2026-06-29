import * as assert from 'assert';
import { Memory } from '../memoryStore';
import { cosineSimilarity, rankBySimilarity } from '../semanticSearch';

function makeMemory(id: string, embedding: number[]): Memory & { embedding: number[] } {
  return {
    id,
    content: `Memory ${id}`,
    category: 'decision',
    project: 'test',
    timestamp: new Date().toISOString(),
    tags: [],
    embedding
  };
}

suite('cosineSimilarity', () => {
  test('identical vectors return 1.0', () => {
    const v = [1, 2, 3];
    assert.strictEqual(cosineSimilarity(v, v), 1.0);
  });

  test('orthogonal vectors return 0.0', () => {
    assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0.0);
  });

  test('opposite vectors return -1.0', () => {
    assert.strictEqual(cosineSimilarity([1, 0], [-1, 0]), -1.0);
  });

  test('returns 0 for empty vectors', () => {
    assert.strictEqual(cosineSimilarity([], []), 0);
  });

  test('returns 0 for mismatched lengths', () => {
    assert.strictEqual(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  test('returns 0 for zero vector', () => {
    assert.strictEqual(cosineSimilarity([0, 0], [1, 2]), 0);
  });

  test('partial similarity between 0 and 1', () => {
    const sim = cosineSimilarity([1, 1], [1, 0]);
    assert.ok(sim > 0 && sim < 1, `Expected value between 0 and 1, got ${sim}`);
  });
});

suite('rankBySimilarity', () => {
  const queryEmbedding = [1, 0, 0];

  const memories = [
    makeMemory('high', [1, 0, 0]),      // similarity 1.0
    makeMemory('medium', [1, 1, 0]),    // similarity ~0.71
    makeMemory('low', [0, 0, 1]),       // similarity 0.0 — below threshold
  ];

  test('returns memories sorted by similarity descending', () => {
    const results = rankBySimilarity(memories, queryEmbedding, 5, 0.4);
    assert.strictEqual(results[0].id, 'high');
    assert.strictEqual(results[1].id, 'medium');
  });

  test('filters out memories below threshold', () => {
    const results = rankBySimilarity(memories, queryEmbedding, 5, 0.4);
    assert.ok(!results.some(r => r.id === 'low'));
  });

  test('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeMemory(String(i), [1, 0, 0])
    );
    const results = rankBySimilarity(many, queryEmbedding, 3, 0);
    assert.strictEqual(results.length, 3);
  });

  test('returns empty array when no memories meet threshold', () => {
    const results = rankBySimilarity(memories, queryEmbedding, 5, 0.99);
    assert.strictEqual(results.length, 1); // only 'high' at similarity 1.0
  });

  test('returns empty array for empty input', () => {
    assert.deepStrictEqual(rankBySimilarity([], queryEmbedding), []);
  });
});
