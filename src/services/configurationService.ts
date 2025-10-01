import * as vscode from 'vscode';

export class ConfigurationService {
  private context: vscode.ExtensionContext;
  private readonly API_KEY_SECRET = 'openai-api-key';
  private readonly THREAD_ID_KEY = 'openai-thread-id';
  private readonly THREADS_KEY = 'openai-threads';
  private readonly ACTIVE_THREAD_KEY = 'openai-active-thread';
  private readonly THREAD_NAMES_KEY = 'openai-thread-names';
  private readonly CONFIG_PREFIX = 'openai-config-';
  private _onConfigChange = new vscode.EventEmitter<void>();
  public readonly onConfigChange = this._onConfigChange.event;
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('openaiAgent')) {
        this._onConfigChange.fire();
      }
    });
  }
  
  public getConfiguration(): vscode.WorkspaceConfiguration {
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
  
  public setModel(value: string): Thenable<void> {
    return this.getConfiguration().update('model', value, true);
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

  public getApiKeySync(): string | undefined {
    // This is a synchronous getter, use with caution as it might return undefined if not loaded yet
    return undefined; // Cannot access secrets synchronously
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

  public getMcpServers(): any[] {
    return this.getConfiguration().get<any[]>('mcp.servers') || [];
  }

  public async getConfigValue(key: string): Promise<any> {
    return this.getConfiguration().get(key);
  }

  public async setConfigValue(key: string, value: any): Promise<void> {
    await this.getConfiguration().update(key, value, true);
  }
}
