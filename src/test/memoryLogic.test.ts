import * as assert from 'assert';
import { Memory } from '../memoryStore';
import {
  extractTags,
  scoreMemory,
  parseSearchTerms,
  rankMemories,
  buildInstructionsBlock,
  mergeInstructions,
  removeBlock
} from '../memoryLogic';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'test-id',
    content: 'We use factory pattern for AI engine creation',
    category: 'decision',
    project: 'test-project',
    timestamp: new Date().toISOString(),
    tags: ['factory', 'AI'],
    ...overrides
  };
}

suite('extractTags', () => {
  test('extracts capitalized words (normalized to lowercase)', () => {
    const tags = extractTags('We use FactoryPattern for ASREngine creation');
    assert.ok(tags.includes('factorypattern'));
    assert.ok(tags.includes('asrengine'));
  });

  test('extracts known tech terms case-insensitively', () => {
    const tags = extractTags('use async factory and repository pattern');
    assert.ok(tags.some(t => t.toLowerCase() === 'async'));
    assert.ok(tags.some(t => t.toLowerCase() === 'factory'));
    assert.ok(tags.some(t => t.toLowerCase() === 'repository'));
  });

  test('deduplicates tags', () => {
    const tags = extractTags('Factory factory FACTORY');
    const factoryTags = tags.filter(t => t.toLowerCase() === 'factory');
    assert.strictEqual(factoryTags.length, 1);
  });

  test('returns empty array for plain lowercase text with no tech terms', () => {
    const tags = extractTags('we do things this way');
    assert.strictEqual(tags.length, 0);
  });
});

suite('parseSearchTerms', () => {
  test('lowercases and splits on whitespace', () => {
    assert.deepStrictEqual(parseSearchTerms('Factory Pattern'), ['factory', 'pattern']);
  });

  test('filters out short words under 3 characters', () => {
    const terms = parseSearchTerms('we use it for ASR');
    assert.ok(!terms.includes('we'));
    assert.ok(!terms.includes('it'));
    assert.ok(!terms.includes('for'));
    assert.ok(terms.includes('use'));
    assert.ok(terms.includes('asr'));
  });

  test('returns empty array for blank query', () => {
    assert.deepStrictEqual(parseSearchTerms('   '), []);
  });
});

suite('scoreMemory', () => {
  test('returns 0 when no terms match', () => {
    const memory = makeMemory({ content: 'Use factory pattern', tags: [] });
    assert.strictEqual(scoreMemory(memory, ['auth', 'cache']), 0);
  });

  test('counts matching terms in content', () => {
    const memory = makeMemory({ content: 'Use factory pattern for engine', tags: [] });
    assert.strictEqual(scoreMemory(memory, ['factory', 'pattern']), 2);
  });

  test('counts matching terms in tags', () => {
    const memory = makeMemory({ content: 'some content', tags: ['Factory', 'Strategy'] });
    assert.strictEqual(scoreMemory(memory, ['factory']), 1);
  });

  test('does not double-count a term matching both content and tags', () => {
    const memory = makeMemory({ content: 'factory approach', tags: ['factory'] });
    assert.strictEqual(scoreMemory(memory, ['factory']), 1);
  });
});

suite('rankMemories', () => {
  const memories: Memory[] = [
    makeMemory({ id: '1', content: 'Use factory pattern for ASR', tags: ['factory', 'ASR'] }),
    makeMemory({ id: '2', content: 'Auth uses JWT tokens', tags: ['auth', 'JWT'] }),
    makeMemory({ id: '3', content: 'Factory and strategy for TTS engine', tags: ['factory', 'strategy'] })
  ];

  test('returns only memories that match the query', () => {
    const results = rankMemories(memories, 'auth jwt');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, '2');
  });

  test('ranks higher-scoring memories first', () => {
    // 'factory strategy' → memory[2] scores 2 (both terms in content), memory[0] scores 1 (factory only)
    const results = rankMemories(memories, 'factory strategy');
    assert.strictEqual(results[0].id, '3');
  });

  test('returns empty array when nothing matches', () => {
    assert.deepStrictEqual(rankMemories(memories, 'kubernetes'), []);
  });

  test('returns empty array for blank query', () => {
    assert.deepStrictEqual(rankMemories(memories, '   '), []);
  });

  test('respects the limit', () => {
    const manyMemories = Array.from({ length: 10 }, (_, i) =>
      makeMemory({ id: String(i), content: `factory approach number ${i}` })
    );
    const results = rankMemories(manyMemories, 'factory', 3);
    assert.strictEqual(results.length, 3);
  });
});

suite('buildInstructionsBlock', () => {
  test('groups memories by category', () => {
    const memories: Memory[] = [
      makeMemory({ content: 'Use factory pattern', category: 'decision' }),
      makeMemory({ content: 'Known auth bug', category: 'bug' })
    ];
    const block = buildInstructionsBlock(memories);
    assert.ok(block.includes('### Decisions'));
    assert.ok(block.includes('### Bugs'));
    assert.ok(block.includes('- Use factory pattern'));
    assert.ok(block.includes('- Known auth bug'));
  });

  test('wraps content in start and end markers', () => {
    const block = buildInstructionsBlock([makeMemory()]);
    assert.ok(block.startsWith('<!-- copilot-memory:start -->'));
    assert.ok(block.endsWith('<!-- copilot-memory:end -->'));
  });
});

suite('mergeInstructions', () => {
  const block = '<!-- copilot-memory:start -->\ncontent\n<!-- copilot-memory:end -->';

  test('appends block when file has no existing markers', () => {
    const result = mergeInstructions('# Existing header', block);
    assert.ok(result.startsWith('# Existing header'));
    assert.ok(result.includes(block));
  });

  test('replaces existing block between markers', () => {
    const existing = `# Header\n\n<!-- copilot-memory:start -->\nold content\n<!-- copilot-memory:end -->`;
    const newBlock = '<!-- copilot-memory:start -->\nnew content\n<!-- copilot-memory:end -->';
    const result = mergeInstructions(existing, newBlock);
    assert.ok(!result.includes('old content'));
    assert.ok(result.includes('new content'));
    assert.ok(result.includes('# Header'));
  });

  test('handles empty existing file', () => {
    const result = mergeInstructions('', block);
    assert.strictEqual(result, block);
  });
});

suite('removeBlock', () => {
  test('removes block and markers from file', () => {
    const existing = `# Header\n\n<!-- copilot-memory:start -->\nsome memory\n<!-- copilot-memory:end -->`;
    const result = removeBlock(existing);
    assert.ok(!result.includes('copilot-memory'));
    assert.ok(!result.includes('some memory'));
    assert.ok(result.includes('# Header'));
  });

  test('returns original string when no markers present', () => {
    const existing = '# No markers here';
    assert.strictEqual(removeBlock(existing), existing);
  });
});
