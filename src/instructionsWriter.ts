import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Memory, MemoryStore } from './memoryStore';
import { buildInstructionsBlock, mergeInstructions, removeBlock } from './memoryLogic';

export class InstructionsWriter {
  constructor(private store: MemoryStore) {}

  async refresh(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const instructionsPath = path.join(
      workspaceFolder.uri.fsPath,
      '.github',
      'copilot-instructions.md'
    );

    const memories = await this.store.getRecent(20);

    let existing = '';
    try {
      existing = await fs.readFile(instructionsPath, 'utf-8');
    } catch {
      // file doesn't exist yet — will be created
    }

    const updated = memories.length > 0
      ? mergeInstructions(existing, buildInstructionsBlock(memories))
      : removeBlock(existing);

    if (updated === existing) {
      return;
    }

    await fs.mkdir(path.dirname(instructionsPath), { recursive: true });
    await fs.writeFile(instructionsPath, updated);
  }
}
