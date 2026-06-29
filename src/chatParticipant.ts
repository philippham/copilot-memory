import * as vscode from 'vscode';
import { ConversationLog } from './conversationLog';
import { MemoryStore, MemoryCategory } from './memoryStore';
import { InstructionsWriter } from './instructionsWriter';

const SYSTEM_PROMPT = `You are a helpful AI assistant with persistent memory across sessions.
You have access to saved project memories that have been loaded into your context.
When the user asks you to remember something, confirm that it has been saved.
When the user asks about past decisions or context, reference the saved memories if relevant.`;

const REMEMBER_PATTERN = /^(?:remember|save|note)\s+(?:that\s+)?(?:this\s+)?(.+)/i;
const REMEMBER_THIS_PATTERN = /^(?:remember|save|note)\s+this\.?$/i;

function detectCategory(content: string): MemoryCategory {
  const lower = content.toLowerCase();
  if (/\b(bug|issue|error|broken|fix|workaround)\b/.test(lower)) { return 'bug'; }
  if (/\b(always|never|pattern|convention|style|rule)\b/.test(lower)) { return 'pattern'; }
  if (/\b(decided|decision|chose|choice|architecture|design|approach)\b/.test(lower)) { return 'decision'; }
  return 'context';
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  log: ConversationLog,
  getStore: () => MemoryStore,
  getWriter: () => InstructionsWriter
): void {
  const participant = vscode.chat.createChatParticipant(
    'copilot-memory.mem',
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      response: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const prompt = request.prompt.trim();
      const store = getStore();
      const writer = getWriter();

      // Handle: "@mem remember this" — save the previous message
      if (REMEMBER_THIS_PATTERN.test(prompt)) {
        const lastUserTurn = [...chatContext.history]
          .reverse()
          .find((t): t is vscode.ChatRequestTurn => t instanceof vscode.ChatRequestTurn);

        if (!lastUserTurn) {
          response.markdown('Nothing to remember yet — say something first, then ask me to remember it.');
          return;
        }

        const content = lastUserTurn.prompt;
        const category = detectCategory(content);
        await store.save(content, category);
        await writer.refresh();
        await log.append({ role: 'user', content: prompt, timestamp: new Date().toISOString() });
        await log.append({ role: 'assistant', content: `Saved: "${content}"`, timestamp: new Date().toISOString() });
        response.markdown(`Saved to memory as **${category}**: *"${content}"*`);
        return;
      }

      // Handle: "@mem remember we use factory pattern..."
      const rememberMatch = prompt.match(REMEMBER_PATTERN);
      if (rememberMatch) {
        const content = rememberMatch[1].trim();
        const category = detectCategory(content);
        await store.save(content, category);
        await writer.refresh();
        await log.append({ role: 'user', content: prompt, timestamp: new Date().toISOString() });
        await log.append({ role: 'assistant', content: `Saved: "${content}"`, timestamp: new Date().toISOString() });
        response.markdown(`Saved to memory as **${category}**: *"${content}"*`);
        return;
      }

      // All other messages — forward to Copilot with system context
      const model = request.model;
      if (!model) {
        response.markdown('No language model available. Make sure GitHub Copilot is active.');
        return;
      }

      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)
      ];

      for (const turn of chatContext.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
          messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
        } else if (turn instanceof vscode.ChatResponseTurn) {
          const text = turn.response
            .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
            .map(p => p.value.value)
            .join('');
          if (text) {
            messages.push(vscode.LanguageModelChatMessage.Assistant(text));
          }
        }
      }

      messages.push(vscode.LanguageModelChatMessage.User(prompt));

      const result = await model.sendRequest(messages, {}, token);
      let fullResponse = '';
      for await (const chunk of result.text) {
        response.markdown(chunk);
        fullResponse += chunk;
      }

      await log.append({ role: 'user', content: prompt, timestamp: new Date().toISOString() });
      await log.append({ role: 'assistant', content: fullResponse, timestamp: new Date().toISOString() });
    }
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
  context.subscriptions.push(participant);
}
