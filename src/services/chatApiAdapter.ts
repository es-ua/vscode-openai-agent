import * as vscode from 'vscode';
import { OpenAIChatService } from './openAIChatService';
import { ConfigurationService } from './configurationService';
import { PermissionService } from './permissionService';
import { McpManager } from './mcpManager';
import { McpClient } from './mcpClient';
import { SearchResult } from '../types/rag';
import { OpenAIServiceInterface } from './openAIServiceInterface';

export class ChatApiAdapter implements OpenAIServiceInterface {
  private openAIChatService: OpenAIChatService;
  private configService: ConfigurationService;
  private mcpManager: McpManager;
  private mcpClient: McpClient;
  private permissionService: PermissionService;
  private view?: vscode.WebviewView;

  constructor(configService: ConfigurationService, extensionPath: string) {
    this.configService = configService;
    
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || extensionPath;
    this.permissionService = new PermissionService(workspaceRoot);
    this.mcpClient = new McpClient();
    this.mcpManager = new McpManager();

    // Initialize with empty API key, will be set properly in initialize()
    this.openAIChatService = new OpenAIChatService('', this.configService.getModel());
  }

  async initialize(): Promise<void> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) {
      vscode.window.showWarningMessage('OpenAI API key is not set. Please set your API key to use the OpenAI Agent', 'Set API Key')
        .then(selection => {
          if (selection === 'Set API Key') {
            vscode.commands.executeCommand('vscode-openai-agent.setApiKey');
          }
        });
      return;
    }

    this.openAIChatService = new OpenAIChatService(apiKey, this.configService.getModel());
    await this.openAIChatService.initialize();
    
    await this.mcpManager.startServers(this.configService.getMcpServers());
    await this.mcpClient.start(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
  }

  setView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    this.permissionService.setView(webviewView);
  }

  async chat(prompt: string, onThinking?: (step: string) => void): Promise<string> {
    return this.openAIChatService.chat(prompt, onThinking);
  }

  async newThread(): Promise<string> {
    return this.openAIChatService.newThread();
  }

  getThreadInfo(): { threads: string[]; active: string | undefined; threadNames: { [id: string]: string } } {
    return this.openAIChatService.getThreadInfo();
  }

  async getThreadHistory(threadId: string): Promise<any[]> {
    return this.openAIChatService.getThreadHistory(threadId);
  }

  async setActiveThread(threadId: string): Promise<void> {
    return this.openAIChatService.setActiveThread(threadId);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    return this.openAIChatService.setThreadName(threadId, name);
  }

  async cancelCurrentRun(): Promise<void> {
    // No runs to cancel in Chat Completions API
    return Promise.resolve();
  }

  getPermissionService(): PermissionService {
    return this.permissionService;
  }

  async getCompletion(context: string, language: string): Promise<string | null> {
    return this.openAIChatService.getCompletion(context, language);
  }

  async addImage(imageData: Buffer, description: string): Promise<string> {
    return this.openAIChatService.addImage(imageData, description);
  }

  async addAudio(audioData: Buffer, filename: string, description: string): Promise<string> {
    return this.openAIChatService.addAudio(audioData, filename, description);
  }

  async addDecision(decision: { title: string; description: string; reasoning: string; tags: string[] }): Promise<void> {
    return this.openAIChatService.addDecision(decision);
  }

  async getRelevantDecisions(query: string): Promise<any[]> {
    return this.openAIChatService.getRelevantDecisions(query);
  }

  async indexWorkspaceCode(): Promise<void> {
    return this.openAIChatService.indexWorkspaceCode();
  }

  async searchContext(query: string): Promise<SearchResult[]> {
    return this.openAIChatService.searchContext(query);
  }
}
