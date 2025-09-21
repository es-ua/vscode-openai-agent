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
  private basePath: string;

  constructor(configService: ConfigurationService, basePath: string) {
    this.configService = configService;
    this.basePath = basePath;
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
        const root = this.basePath || process.cwd();
        await this.mcp.start(root);
      } catch (e) {
        console.warn('Failed to start MCP server, proceeding without tools:', e);
      }

      this.assistantId = await this.getOrCreateAssistant(apiKey);
      const existing = this.configService.getActiveThreadId();
      if (existing) { this.threadId = existing; } else { this.threadId = await this.createThread(apiKey);
      const list = this.configService.getThreads();
      if (!list.includes(this.threadId)) { list.push(this.threadId); await this.configService.setThreads(list); }
      await this.configService.setActiveThreadId(this.threadId);
      await this.configService.setThreadId(this.threadId); }
      const list = this.configService.getThreads();
      if (this.threadId && !list.includes(this.threadId)) { list.push(this.threadId); await this.configService.setThreads(list); }
      if (this.threadId) { await this.configService.setActiveThreadId(this.threadId); await this.configService.setThreadId(this.threadId); }

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
      let response;
      try {
        response = await this.client.post('/assistants', {
        name: 'VS Code Coding Assistant',
        description: 'An AI assistant that helps with coding in VS Code',
        model: this.configService.getModel(),
        tools: [
          { type: 'code_interpreter' },
          { type: 'function', function: { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'search_workspace', description: 'Search files in the workspace', parameters: { type: 'object', properties: { root: { type: 'string' }, includeGlobs: { type: 'array', items: { type: 'string' } }, excludeGlobs: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, maxMatches: { type: 'number' }, maxFileBytes: { type: 'number' } } } } },
          { type: 'function', function: { name: 'upsert_file', description: 'Create or overwrite a file with given content', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
          { type: 'function', function: { name: 'append_file', description: 'Append content to a file (creates if missing)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
          { type: 'function', function: { name: 'make_dir', description: 'Create a directory (recursive)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
        ],
        instructions: `You are an AI programming assistant embedded in VS Code.\nYour primary role is to help users write code by providing intelligent code completions and suggestions.\nAnalyze the code context provided and generate relevant, high-quality code completions.\nFocus on producing working, efficient, and idiomatic code in the language being used.\nWhen possible, follow the coding style evident in the existing code.\nKeep your responses focused on code completion unless specifically asked for explanations.`
      }, { headers: this.authHeaders(apiKey) });
      } catch (e: any) {
        const msg = e?.response?.data?.error?.message || '';
        if (/cannot be used with the Assistants API/i.test(msg)) {
          const fallbackModel = 'gpt-4o-mini';
          response = await this.client.post('/assistants', {
            name: 'VS Code Coding Assistant',
            description: 'An AI assistant that helps with coding in VS Code',
            model: fallbackModel,
            tools: [
              { type: 'code_interpreter' },
              { type: 'function', function: { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } } },
              { type: 'function', function: { name: 'search_workspace', description: 'Search files in the workspace', parameters: { type: 'object', properties: { root: { type: 'string' }, includeGlobs: { type: 'array', items: { type: 'string' } }, excludeGlobs: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, maxMatches: { type: 'number' }, maxFileBytes: { type: 'number' } } } } },
              { type: 'function', function: { name: 'upsert_file', description: 'Create or overwrite a file with given content', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
              { type: 'function', function: { name: 'append_file', description: 'Append content to a file (creates if missing)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
              { type: 'function', function: { name: 'make_dir', description: 'Create a directory (recursive)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
              { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
            ]
          }, { headers: this.authHeaders(apiKey) });
        } else { throw e; }
      }

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
              else if (name === 'upsert_file' && this.mcp) result = await this.mcp.request('upsert_file', args);
              else if (name === 'append_file' && this.mcp) result = await this.mcp.request('append_file', args);
              else if (name === 'make_dir' && this.mcp) result = await this.mcp.request('make_dir', args);
              else if (name === 'delete_file' && this.mcp) result = await this.mcp.request('delete_file', args);
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


  public getThreadInfo() {
    const threads = this.configService.getThreads();
    const threadNames = this.configService.getThreadNames();
    return { 
      threads, 
      active: this.configService.getActiveThreadId() || this.threadId,
      threadNames 
    };
  }

  public async getThreadHistory(threadId: string): Promise<Array<{role: string, content: string}>> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');

    try {
      const response = await this.client.get(`/threads/${threadId}/messages`, {
        params: { limit: 100, order: 'asc' },
        headers: this.authHeaders(apiKey)
      });

      if (response.data.data && response.data.data.length > 0) {
        const messages: Array<{role: string, content: string}> = [];
        
        for (const message of response.data.data) {
          if (message.role === 'user' || message.role === 'assistant') {
            let textContent = '';
            if (message.content && message.content.length > 0) {
              for (const contentItem of message.content) {
                if (contentItem.type === 'text') {
                  textContent += contentItem.text.value;
                }
              }
            }
            if (textContent.trim()) {
              messages.push({
                role: message.role,
                content: textContent.trim()
              });
            }
          }
        }
        
        return messages;
      }
      
      return [];
    } catch (error: any) {
      console.error('Error retrieving thread history:', error.response?.data || error.message);
      throw new Error(`Failed to retrieve thread history: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  public async setActiveThread(id: string): Promise<void> {
    this.threadId = id;
    await this.configService.setActiveThreadId(id);
    await this.configService.setThreadId(id);
  }

  public async setThreadName(threadId: string, name: string): Promise<void> {
    await this.configService.setThreadName(threadId, name);
  }

  public async newThread(): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    const id = await this.createThread(apiKey);
    const list = this.configService.getThreads();
    if (!list.includes(id)) { list.push(id); await this.configService.setThreads(list); }
    await this.setActiveThread(id);
    return id;
  }

  public async closeThread(id: string): Promise<void> {
    const list = this.configService.getThreads().filter(t => t !== id);
    await this.configService.setThreads(list);
    const active = this.configService.getActiveThreadId();
    if (active === id) {
      const next = list[list.length - 1];
      if (next) await this.setActiveThread(next);
    }
  }

  public async resetThread(): Promise<void> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    try {
      this.threadId = await this.createThread(apiKey);
      const list = this.configService.getThreads();
      if (!list.includes(this.threadId)) { list.push(this.threadId); await this.configService.setThreads(list); }
      await this.configService.setActiveThreadId(this.threadId);
      await this.configService.setThreadId(this.threadId);
    } catch (error: any) {
      console.error('Error resetting thread:', error.response?.data || error.message);
      throw new Error(`Failed to reset thread: ${error.response?.data?.error?.message || error.message}`);
    }
  }
}
