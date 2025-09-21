import * as vscode from 'vscode';

export class ConfigurationService {
  private context: vscode.ExtensionContext;
  private readonly API_KEY_SECRET = 'openai-api-key';
  private readonly ASSISTANT_ID_KEY = 'openai-assistant-id';
  
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
}
