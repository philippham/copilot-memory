import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { extractTags, rankMemories } from './memoryLogic';
import { OllamaClient } from './ollamaClient';
import { rankBySimilarity } from './semanticSearch';

export type MemoryCategory = 'decision' | 'pattern' | 'context' | 'bug';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  project: string;
  timestamp: string;
  tags: string[];
  embedding?: number[];
}

interface MemoryFile {
  memories: Memory[];
}

export class MemoryStore {
  private storePath: string;

  constructor(
    context: vscode.ExtensionContext,
    private ollama: OllamaClient | null
  ) {
    this.storePath = path.join(context.globalStorageUri.fsPath, 'memories.json');
  }

  async save(content: string, category: MemoryCategory): Promise<Memory> {
    const memories = await this.loadAll();
    const memory: Memory = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      content,
      category,
      project: this.currentProject(),
      timestamp: new Date().toISOString(),
      tags: extractTags(content)
    };

    if (this.ollama) {
      try {
        memory.embedding = await this.ollama.embed(content);
      } catch {
        // save without embedding; keyword search will cover it
      }
    }

    memories.push(memory);
    await this.persist(memories);
    return memory;
  }

  async search(query: string): Promise<Memory[]> {
    const memories = await this.loadAll();
    const project = this.currentProject();
    const projectMemories = memories.filter(m => m.project === project);

    if (this.ollama) {
      try {
        const queryEmbedding = await this.ollama.embed(query);
        const withEmbeddings = projectMemories.filter(
          (m): m is Memory & { embedding: number[] } => Array.isArray(m.embedding)
        );
        if (withEmbeddings.length > 0) {
          return rankBySimilarity(withEmbeddings, queryEmbedding);
        }
      } catch {
        // fall through to keyword search
      }
    }

    return rankMemories(projectMemories, query);
  }

  async getRecent(limit = 20): Promise<Memory[]> {
    const memories = await this.loadAll();
    const project = this.currentProject();
    return memories
      .filter(m => m.project === project)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async deleteById(id: string): Promise<void> {
    const memories = await this.loadAll();
    await this.persist(memories.filter(m => m.id !== id));
  }

  async clearAll(): Promise<void> {
    const memories = await this.loadAll();
    const project = this.currentProject();
    await this.persist(memories.filter(m => m.project !== project));
  }

  private async loadAll(): Promise<Memory[]> {
    try {
      await fs.mkdir(path.dirname(this.storePath), { recursive: true });
      const raw = await fs.readFile(this.storePath, 'utf-8');
      const data: MemoryFile = JSON.parse(raw);
      return data.memories ?? [];
    } catch {
      return [];
    }
  }

  private async persist(memories: Memory[]): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify({ memories }, null, 2));
  }

  private currentProject(): string {
    return vscode.workspace.workspaceFolders?.[0]?.name ?? 'default';
  }
}
