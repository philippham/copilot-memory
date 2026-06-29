import * as vscode from 'vscode';
import { MemoryCategory, MemoryStore } from './memoryStore';
import { InstructionsWriter } from './instructionsWriter';
import { OllamaClient } from './ollamaClient';
import { runSetupWizard } from './setupWizard';
import { ConversationLog } from './conversationLog';
import { registerChatParticipant } from './chatParticipant';

const CATEGORIES: { label: MemoryCategory; description: string }[] = [
  { label: 'decision', description: 'Architectural or design choice' },
  { label: 'pattern', description: 'Code pattern to follow consistently' },
  { label: 'context', description: 'Project background or constraint' },
  { label: 'bug', description: 'Known issue or workaround' }
];

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('copilotMemory');
  return {
    semanticEnabled: cfg.get<boolean>('semanticSearch.enabled', false),
    ollamaUrl: cfg.get<string>('semanticSearch.ollamaUrl', 'http://localhost:11434'),
    ollamaModel: cfg.get<string>('semanticSearch.ollamaModel', 'nomic-embed-text')
  };
}

function buildOllamaClient(): OllamaClient | null {
  const { semanticEnabled, ollamaUrl, ollamaModel } = getConfig();
  if (!semanticEnabled) {
    return null;
  }
  return new OllamaClient({ baseUrl: ollamaUrl, model: ollamaModel });
}

async function checkForPreviousSession(log: ConversationLog): Promise<void> {
  const last = await log.getLastSession();
  if (!last || last.messages.length === 0) {
    return;
  }

  const sessionDate = new Date(last.startTime);
  const ageMs = Date.now() - sessionDate.getTime();
  const oneHour = 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (ageMs < oneHour || ageMs > sevenDays) {
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `Copilot Memory: Resume your session from ${sessionDate.toLocaleDateString()}?`,
    'Resume',
    'Dismiss'
  );

  if (action !== 'Resume') {
    return;
  }

  // Build a concise context from the last 10 messages
  const recent = last.messages.slice(-10);
  const transcript = recent
    .map(m => `${m.role === 'user' ? 'You' : 'Copilot'}: ${m.content}`)
    .join('\n\n');

  await vscode.commands.executeCommand('workbench.action.chat.open', {
    query: `@mem Resume our previous session. Here is what we discussed:\n\n${transcript}\n\nContinue from here.`
  });
}

export function activate(context: vscode.ExtensionContext) {
  let ollama = buildOllamaClient();
  let store = new MemoryStore(context, ollama);
  let writer = new InstructionsWriter(store);
  const log = new ConversationLog(context);

  registerChatParticipant(context, log, () => store, () => writer);
  checkForPreviousSession(log);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'copilot-memory.status';
  context.subscriptions.push(statusBar);

  async function refreshStatus() {
    const { semanticEnabled } = getConfig();
    if (!semanticEnabled) {
      statusBar.text = '$(database) Copilot Memory';
      statusBar.tooltip = 'Copilot Memory: keyword search active. Enable semantic search in settings.';
    } else {
      const available = ollama ? await ollama.isAvailable() : false;
      statusBar.text = available
        ? '$(sparkle) Copilot Memory'
        : '$(warning) Copilot Memory';
      statusBar.tooltip = available
        ? 'Copilot Memory: semantic search active (Ollama connected)'
        : 'Copilot Memory: Ollama not reachable — falling back to keyword search';
    }
    statusBar.show();
  }

  refreshStatus();

  // Rebuild store when settings change; run wizard when semantic search is first enabled
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (!e.affectsConfiguration('copilotMemory')) {
        return;
      }
      const { semanticEnabled, ollamaUrl, ollamaModel } = getConfig();
      if (semanticEnabled && e.affectsConfiguration('copilotMemory.semanticSearch.enabled')) {
        await runSetupWizard(ollamaUrl, ollamaModel);
      }
      ollama = buildOllamaClient();
      store = new MemoryStore(context, ollama);
      writer = new InstructionsWriter(store);
      refreshStatus();
    })
  );

  writer.refresh();

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-memory.remember', async () => {
      const content = await vscode.window.showInputBox({
        prompt: 'What should Copilot remember?',
        placeHolder: 'e.g. We use factory pattern for all AI engine creation'
      });
      if (!content) {
        return;
      }

      const category = await vscode.window.showQuickPick(CATEGORIES, {
        placeHolder: 'Select a category'
      });
      if (!category) {
        return;
      }

      await store.save(content, category.label);
      await writer.refresh();
      vscode.window.showInformationMessage(
        `Memory saved: "${content.length > 60 ? content.slice(0, 60) + '…' : content}"`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-memory.show', async () => {
      const memories = await store.getRecent(50);
      if (memories.length === 0) {
        vscode.window.showInformationMessage('No memories saved for this project yet.');
        return;
      }

      const CATEGORY_ICONS: Record<string, string> = {
        decision: '$(law)',
        pattern: '$(symbol-misc)',
        context: '$(info)',
        bug: '$(bug)'
      };

      const selected = await vscode.window.showQuickPick(
        memories.map(m => ({
          label: `${CATEGORY_ICONS[m.category] ?? '$(circle)'} ${m.content.length > 72 ? m.content.slice(0, 72) + '…' : m.content}`,
          description: new Date(m.timestamp).toLocaleDateString(),
          detail: m.content.length > 72 ? m.content : undefined,
          memory: m
        })),
        { placeHolder: `${memories.length} memories — pick one to manage` }
      );

      if (!selected) {
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          { label: '$(comment-discussion) Send to Copilot Chat', action: 'chat' },
          { label: '$(copy) Copy to clipboard', action: 'copy' },
          { label: '$(trash) Delete this memory', action: 'delete' }
        ],
        { placeHolder: selected.memory.content }
      );

      if (!action) {
        return;
      }

      if (action.action === 'chat') {
        await vscode.commands.executeCommand('workbench.action.chat.open', {
          query: `Here is some saved context for this project: "${selected.memory.content}". Let's continue from here.`
        });
      } else if (action.action === 'copy') {
        await vscode.env.clipboard.writeText(selected.memory.content);
        vscode.window.showInformationMessage('Memory copied to clipboard.');
      } else if (action.action === 'delete') {
        const confirm = await vscode.window.showWarningMessage(
          `Delete: "${selected.memory.content.slice(0, 60)}…"?`,
          { modal: true },
          'Delete'
        );
        if (confirm === 'Delete') {
          await store.deleteById(selected.memory.id);
          await writer.refresh();
          vscode.window.showInformationMessage('Memory deleted.');
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-memory.clear', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all memories for this project? This cannot be undone.',
        { modal: true },
        'Clear'
      );
      if (confirm !== 'Clear') {
        return;
      }
      await store.clearAll();
      await writer.refresh();
      vscode.window.showInformationMessage('All memories cleared for this project.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-memory.setupOllama', async () => {
      const { ollamaUrl, ollamaModel } = getConfig();
      await runSetupWizard(ollamaUrl, ollamaModel);
      ollama = buildOllamaClient();
      store = new MemoryStore(context, ollama);
      writer = new InstructionsWriter(store);
      refreshStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-memory.status', async () => {
      const { semanticEnabled, ollamaUrl, ollamaModel } = getConfig();
      if (!semanticEnabled) {
        const open = await vscode.window.showInformationMessage(
          'Copilot Memory: semantic search is disabled. Enable it in settings to use Ollama.',
          'Open Settings'
        );
        if (open) {
          vscode.commands.executeCommand('workbench.action.openSettings', 'copilotMemory.semanticSearch');
        }
        return;
      }
      const available = ollama ? await ollama.isAvailable() : false;
      vscode.window.showInformationMessage(
        available
          ? `Copilot Memory: Ollama connected at ${ollamaUrl} using model "${ollamaModel}"`
          : `Copilot Memory: Ollama not reachable at ${ollamaUrl} — using keyword search`
      );
    })
  );

  context.subscriptions.push(
    vscode.lm.registerTool('copilot-memory_recall', {
      invoke: async (
        options: vscode.LanguageModelToolInvocationOptions<{ query: string }>,
        _token: vscode.CancellationToken
      ) => {
        const results = await store.search(options.input.query);
        if (results.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('No matching memories found for this project.')
          ]);
        }
        const formatted = results
          .map(m => `[${m.category}] ${m.content} (saved: ${new Date(m.timestamp).toLocaleDateString()})`)
          .join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Found ${results.length} relevant memories:\n${formatted}`)
        ]);
      }
    })
  );

  context.subscriptions.push(
    vscode.lm.registerTool('copilot-memory_save', {
      invoke: async (
        options: vscode.LanguageModelToolInvocationOptions<{ content: string; category: string }>,
        _token: vscode.CancellationToken
      ) => {
        const validCategories: MemoryCategory[] = ['decision', 'pattern', 'context', 'bug'];
        const category = validCategories.includes(options.input.category as MemoryCategory)
          ? (options.input.category as MemoryCategory)
          : 'context';

        await store.save(options.input.content, category);
        await writer.refresh();
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('Memory saved successfully.')
        ]);
      }
    })
  );
}

export function deactivate() {}
