import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  project: string;
  startTime: string;
  messages: ChatMessage[];
}

interface LogFile {
  sessions: Session[];
}

const MAX_SESSIONS_PER_PROJECT = 10;

export class ConversationLog {
  private logPath: string;
  private currentSession: Session | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.logPath = path.join(context.globalStorageUri.fsPath, 'conversations.json');
  }

  async startSession(): Promise<void> {
    this.currentSession = {
      id: Date.now().toString(36),
      project: this.currentProject(),
      startTime: new Date().toISOString(),
      messages: []
    };
    await this.persist();
  }

  async append(message: ChatMessage): Promise<void> {
    if (!this.currentSession) {
      await this.startSession();
    }
    this.currentSession!.messages.push(message);
    await this.persist();
  }

  async getLastSession(): Promise<Session | null> {
    const log = await this.load();
    const project = this.currentProject();
    const sessions = log.sessions.filter(s => s.project === project);
    return sessions.length > 0 ? sessions[sessions.length - 1] : null;
  }

  hasActiveSession(): boolean {
    return this.currentSession !== null && this.currentSession.messages.length > 0;
  }

  private async persist(): Promise<void> {
    if (!this.currentSession) {
      return;
    }
    const log = await this.load();
    const idx = log.sessions.findIndex(s => s.id === this.currentSession!.id);
    if (idx >= 0) {
      log.sessions[idx] = this.currentSession;
    } else {
      log.sessions.push(this.currentSession);
    }

    // Keep only the last N sessions per project
    const project = this.currentProject();
    const projectSessions = log.sessions.filter(s => s.project === project);
    if (projectSessions.length > MAX_SESSIONS_PER_PROJECT) {
      const stale = projectSessions
        .slice(0, projectSessions.length - MAX_SESSIONS_PER_PROJECT)
        .map(s => s.id);
      log.sessions = log.sessions.filter(s => !stale.includes(s.id));
    }

    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.writeFile(this.logPath, JSON.stringify(log, null, 2));
  }

  private async load(): Promise<LogFile> {
    try {
      const raw = await fs.readFile(this.logPath, 'utf-8');
      return JSON.parse(raw) as LogFile;
    } catch {
      return { sessions: [] };
    }
  }

  private currentProject(): string {
    return vscode.workspace.workspaceFolders?.[0]?.name ?? 'default';
  }
}
