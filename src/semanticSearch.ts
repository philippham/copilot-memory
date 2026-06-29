import { Memory } from './memoryStore';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function rankBySimilarity(
  memories: (Memory & { embedding: number[] })[],
  queryEmbedding: number[],
  limit = 5,
  threshold = 0.4
): Memory[] {
  return memories
    .map(m => ({ memory: m, score: cosineSimilarity(m.embedding, queryEmbedding) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ memory }) => memory);
}
