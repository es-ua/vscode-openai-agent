import * as vscode from 'vscode';

export class ConfigurationService {
  private context: vscode.ExtensionContext;
  private readonly API_KEY_SECRET = 'openai-api-key';
  private readonly ASSISTANT_ID_KEY = 'openai-assistant-id';
  private readonly THREAD_ID_KEY = 'openai-thread-id';
  private readonly THREADS_KEY = 'openai-threads';
  private readonly ACTIVE_THREAD_KEY = 'openai-active-thread';
  private readonly THREAD_NAMES_KEY = 'openai-thread-names';
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }
  
  public getConfiguration() {
    return vscode.workspace.getConfiguration('openaiAgent');
  }
  
  public isEnabled(): boolean {
    return this.getConfiguration().get<boolean>('enable') || false;
  }
  
  public setEnabled(value: boolean): Thenable<void> {
    return this.getConfiguration().update('enable', value, true);
  }
  
  public getModel(): string {
    return this.getConfiguration().get<string>('model') || 'gpt-4o-mini';
  }

  public getMode(): 'agent' | 'ask' {
    const m = this.getConfiguration().get<string>('mode') || 'agent';
    return (m === 'ask' ? 'ask' : 'agent');
  }
  
  public getMaxTokens(): number {
    return this.getConfiguration().get<number>('maxTokens') || 1000;
  }
  
  public async getApiKey(): Promise<string | undefined> {
    return await this.context.secrets.get(this.API_KEY_SECRET);
  }
  
  public async setApiKey(apiKey: string): Promise<void> {
    await this.context.secrets.store(this.API_KEY_SECRET, apiKey);
  }
  
  public getAssistantId(): string | undefined {
    return this.context.globalState.get<string>(this.ASSISTANT_ID_KEY);
  }
  
  public setAssistantId(assistantId: string): Thenable<void> {
    return this.context.globalState.update(this.ASSISTANT_ID_KEY, assistantId);
  }
  
  public resetAssistantId(): Thenable<void> {
    return this.context.globalState.update(this.ASSISTANT_ID_KEY, undefined);
  }

  public getThreadId(): string | undefined {
    return this.context.globalState.get<string>(this.THREAD_ID_KEY);
  }

  public setThreadId(threadId: string): Thenable<void> {
    return this.context.globalState.update(this.THREAD_ID_KEY, threadId);
  }

  public resetThreadId(): Thenable<void> {
    return this.context.globalState.update(this.THREAD_ID_KEY, undefined);
  }

  public getThreads(): string[] {
    return this.context.globalState.get<string[]>(this.THREADS_KEY) || [];
  }

  public setThreads(threads: string[]): Thenable<void> {
    return this.context.globalState.update(this.THREADS_KEY, threads);
  }

  public getActiveThreadId(): string | undefined {
    return this.context.globalState.get<string>(this.ACTIVE_THREAD_KEY);
  }

  public setActiveThreadId(id: string): Thenable<void> {
    return this.context.globalState.update(this.ACTIVE_THREAD_KEY, id);
  }

  public getThreadNames(): { [threadId: string]: string } {
    return this.context.globalState.get<{ [threadId: string]: string }>(this.THREAD_NAMES_KEY) || {};
  }

  public setThreadName(threadId: string, name: string): Thenable<void> {
    const names = this.getThreadNames();
    names[threadId] = name;
    return this.context.globalState.update(this.THREAD_NAMES_KEY, names);
  }

  public getThreadName(threadId: string): string | undefined {
    return this.getThreadNames()[threadId];
  }
}
