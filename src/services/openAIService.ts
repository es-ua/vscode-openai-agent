import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { ConfigurationService } from './configurationService';
import { McpClient } from './mcpClient';

export class OpenAIService {
  private client: AxiosInstance;
  private configService: ConfigurationService;
  private assistantId: string | undefined;
  private threadId: string | undefined;
  private mcp: McpClient | null = null;

  constructor(configService: ConfigurationService) {
    this.configService = configService;
    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    });
  }

  private authHeaders(apiKey: string) {
    return { 'Authorization': `Bearer ${apiKey}`, 'OpenAI-Beta': 'assistants=v2' };
  }

  public async initialize(): Promise<void> {
    try {
      const apiKey = await this.configService.getApiKey();
      if (!apiKey) throw new Error('OpenAI API key is not set');

      try {
        this.mcp = new McpClient();
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        await this.mcp.start(ws);
      } catch (e) {
        console.warn('Failed to start MCP server, proceeding without tools:', e);
      }

      this.assistantId = await this.getOrCreateAssistant(apiKey);
      this.threadId = await this.createThread(apiKey);

      vscode.window.showInformationMessage('OpenAI Agent initialized successfully');
    } catch (error: any) {
      console.error('Failed to initialize OpenAI service:', error);
      vscode.window.showErrorMessage(`Failed to initialize OpenAI Agent: ${error.message}`);
      throw error;
    }
  }

  private async getOrCreateAssistant(apiKey: string): Promise<string> {
    const savedAssistantId = this.configService.getAssistantId();
    if (savedAssistantId) {
      try {
        await this.client.get(`/assistants/${savedAssistantId}`, { headers: this.authHeaders(apiKey) });
        return savedAssistantId;
      } catch {
        // will create a new one below
      }
    }

    try {
      const response = await this.client.post('/assistants', {
        name: 'VS Code Coding Assistant',
        description: 'An AI assistant that helps with coding in VS Code',
        model: this.configService.getModel(),
        tools: [
          { type: 'code_interpreter' },
          { type: 'function', function: { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'search_workspace', description: 'Search files in the workspace', parameters: { type: 'object', properties: { root: { type: 'string' }, includeGlobs: { type: 'array', items: { type: 'string' } }, excludeGlobs: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, maxMatches: { type: 'number' }, maxFileBytes: { type: 'number' } } } } }
        ],
        instructions: `You are an AI programming assistant embedded in VS Code.\nYour primary role is to help users write code by providing intelligent code completions and suggestions.\nAnalyze the code context provided and generate relevant, high-quality code completions.\nFocus on producing working, efficient, and idiomatic code in the language being used.\nWhen possible, follow the coding style evident in the existing code.\nKeep your responses focused on code completion unless specifically asked for explanations.`
      }, { headers: this.authHeaders(apiKey) });

      const assistantId = response.data.id;
      this.configService.setAssistantId(assistantId);
      return assistantId;
    } catch (error: any) {
      console.error('Error creating assistant:', error.response?.data || error.message);
      throw new Error(`Failed to create OpenAI assistant: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  private async createThread(apiKey: string): Promise<string> {
    try {
      const response = await this.client.post('/threads', {}, { headers: this.authHeaders(apiKey) });
      return response.data.id;
    } catch (error: any) {
      console.error('Error creating thread:', error.response?.data || error.message);
      throw new Error(`Failed to create thread: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  public async getCompletion(codeContext: string, language: string): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey || !this.assistantId || !this.threadId) {
      await this.initialize();
      if (!apiKey || !this.assistantId || !this.threadId) throw new Error('OpenAI Agent not properly initialized');
    }
    try {
      await this.client.post(`/threads/${this.threadId}/messages`, {
        role: 'user',
        content: [{ type: 'text', text: `I'm writing code in ${language}. Here's the context\n\n${codeContext}\n\nPlease complete the next part of the code.` }]
      }, { headers: this.authHeaders(apiKey) });
      const runResponse = await this.client.post(`/threads/${this.threadId}/runs`, { assistant_id: this.assistantId }, { headers: this.authHeaders(apiKey) });
      const runId = runResponse.data.id;
      return await this.waitForRunCompletion(apiKey, runId);
    } catch (error: any) {
      console.error('OpenAI API Error:', error.response?.data || error.message);
      throw new Error(`OpenAI API Error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  public async chat(userMessage: string): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey || !this.assistantId || !this.threadId) {
      await this.initialize();
      if (!apiKey || !this.assistantId || !this.threadId) throw new Error('OpenAI Agent not properly initialized');
    }
    try {
      await this.client.post(`/threads/${this.threadId}/messages`, { role: 'user', content: [{ type: 'text', text: userMessage }] }, { headers: this.authHeaders(apiKey) });
      const runResponse = await this.client.post(`/threads/${this.threadId}/runs`, { assistant_id: this.assistantId }, { headers: this.authHeaders(apiKey) });
      const runId = runResponse.data.id;
      return await this.waitForRunCompletion(apiKey, runId);
    } catch (e: any) {
      throw new Error(e?.message || String(e));
    }
  }

  private async waitForRunCompletion(apiKey: string, runId: string): Promise<string> {
    const maxAttempts = 60;
    const delayMs = 1000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(`/threads/${this.threadId}/runs/${runId}`, { headers: this.authHeaders(apiKey) });
        const status = response.data.status;
        if (status === 'requires_action') {
          const toolCalls = response.data.required_action?.submit_tool_outputs?.tool_calls || [];
          const outputs: Array<{ tool_call_id: string; output: string }> = [];
          for (const call of toolCalls) {
            const name = call.function?.name;
            const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
            try {
              let result: any = null;
              if (name === 'read_file' && this.mcp) result = await this.mcp.readFile(args.path, args.maxBytes);
              else if (name === 'search_workspace' && this.mcp) result = await this.mcp.searchWorkspace(args);
              else result = { error: `Unknown tool: ${name}` };
              outputs.push({ tool_call_id: call.id, output: JSON.stringify(result).slice(0, 50000) });
            } catch (e: any) {
              outputs.push({ tool_call_id: call.id, output: JSON.stringify({ error: e?.message || String(e) }) });
            }
          }
          await this.client.post(`/threads/${this.threadId}/runs/${runId}/submit_tool_outputs`, { tool_outputs: outputs }, { headers: this.authHeaders(apiKey) });
        } else if (status === 'completed') {
          return await this.getLastAssistantMessage(apiKey);
        } else if (status === 'failed' || status === 'cancelled' || status === 'expired') {
          throw new Error(`Run ${status}: ${response.data.last_error?.message || 'Unknown error'}`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error: any) {
        console.error('Error checking run status:', error.response?.data || error.message);
        throw new Error(`Error checking completion status: ${error.response?.data?.error?.message || error.message}`);
      }
    }
    throw new Error('Timed out waiting for completion');
  }

  private async getLastAssistantMessage(apiKey: string): Promise<string> {
    try {
      const response = await this.client.get(`/threads/${this.threadId}/messages`, { params: { limit: 1, order: 'desc' }, headers: this.authHeaders(apiKey) });
      if (response.data.data && response.data.data.length > 0) {
        const message = response.data.data[0];
        if (message.role === 'assistant' && message.content && message.content.length > 0) {
          let textContent = '';
          for (const contentItem of message.content) {
            if (contentItem.type === 'text') {
              textContent += contentItem.text.value;
            }
          }
          const codeBlockRegex = /```(?:\w+)?\s*([\s\S]*?)```/g;
          const matches = [...textContent.matchAll(codeBlockRegex)];
          if (matches.length > 0) return matches[0][1].trim();
          return textContent.trim();
        }
      }
      return '';
    } catch (error: any) {
      console.error('Error retrieving messages:', error.response?.data || error.message);
      throw new Error(`Error retrieving completion: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  public async resetThread(): Promise<void> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    try {
      this.threadId = await this.createThread(apiKey);
    } catch (error: any) {
      console.error('Error resetting thread:', error.response?.data || error.message);
      throw new Error(`Failed to reset thread: ${error.response?.data?.error?.message || error.message}`);
    }
  }
}
