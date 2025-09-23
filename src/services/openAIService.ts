import * as vscode from 'vscode';
import { ConfigurationService } from './configurationService';
import { McpClient } from './mcpClient';

export class OpenAIService {
  private baseURL: string;
  private configService: ConfigurationService;
  private assistantId: string | undefined;
  private threadId: string | undefined;
  private mcp: McpClient | null = null;
  private basePath: string;
  private currentRunId: string | undefined;
  private sessionCost: number = 0;
  private _view?: vscode.WebviewView;

  constructor(configService: ConfigurationService, basePath: string) {
    this.configService = configService;
    this.basePath = basePath;
    this.baseURL = 'https://api.openai.com/v1';
  }

  private authHeaders(apiKey: string) {
    return { 'Authorization': `Bearer ${apiKey}`, 'OpenAI-Beta': 'assistants=v2' };
  }

  // Pricing per 1M tokens (as of December 2024)
  // Note: Prices are updated based on OpenAI's official pricing
  // For the most accurate pricing, check: https://openai.com/api/pricing/
  private getPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.50, output: 10.00 },           // $2.50/$10.00 per 1M tokens
      'gpt-4o-mini': { input: 0.15, output: 0.60 },       // $0.15/$0.60 per 1M tokens  
      'gpt-4-turbo': { input: 10.00, output: 30.00 },     // $10.00/$30.00 per 1M tokens
      'gpt-4-turbo-preview': { input: 10.00, output: 30.00 }, // $10.00/$30.00 per 1M tokens
      'gpt-4': { input: 30.00, output: 60.00 },           // $30.00/$60.00 per 1M tokens
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 }      // $0.50/$1.50 per 1M tokens
    };
    return pricing[model] || { input: 0.15, output: 0.60 }; // Default to gpt-4o-mini pricing
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.getPricing(model);
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    return inputCost + outputCost;
  }

  public getSessionCost(): number {
    return this.sessionCost;
  }

  public resetSessionCost(): void {
    this.sessionCost = 0;
  }

  public setView(view: vscode.WebviewView): void {
    this._view = view;
  }

  private async makeRequest(method: string, endpoint: string, data?: any, apiKey?: string): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const options: RequestInit = {
      method,
      headers
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  public async initialize(): Promise<void> {
    try {
      const apiKey = await this.configService.getApiKey();
      if (!apiKey) throw new Error('OpenAI API key is not set');

      try {
        this.mcp = new McpClient();
        // Get the workspace folder path instead of extension path
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const root = workspaceFolder || process.cwd();
        console.log('Starting MCP server with workspace path:', root);
        await this.mcp.start(root);
      } catch (e) {
        console.warn('Failed to start MCP server, proceeding without tools:', e);
      }

      // Clear any existing assistant to ensure we create a new one with the correct model
      console.log('Clearing existing assistant to ensure correct model usage');
      await this.configService.setAssistantId('');
      
      // Ensure we have a valid model set
      const currentModel = this.configService.getModel();
      console.log('Current model from config:', currentModel);
      
      // If model is invalid, set a default one
      const validModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-4', 'gpt-3.5-turbo'];
      if (!validModels.includes(currentModel)) {
        console.log('Invalid model detected, setting default model');
        await this.configService.setModel('gpt-4o-mini');
      }
      
      this.assistantId = await this.getOrCreateAssistant(apiKey);
      console.log('Assistant created with model:', currentModel, 'ID:', this.assistantId);
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
    const model = this.configService.getModel();
    console.log('getOrCreateAssistant called with model:', model);
    
    if (savedAssistantId) {
      try {
        await this.makeRequest('GET', `/assistants/${savedAssistantId}`, undefined, apiKey);
        return savedAssistantId;
      } catch {
        // will create a new one below
      }
    }

    try {
      let response;
      try {
        const modelToUse = this.configService.getModel();
        console.log('Creating assistant with model:', modelToUse);
        response = await this.makeRequest('POST', '/assistants', {
        name: 'VS Code Coding Assistant',
        description: 'An AI assistant that helps with coding in VS Code',
        model: modelToUse,
        tools: [
          { type: 'code_interpreter' },
          { type: 'function', function: { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'search_workspace', description: 'Search files in the workspace', parameters: { type: 'object', properties: { root: { type: 'string' }, includeGlobs: { type: 'array', items: { type: 'string' } }, excludeGlobs: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, maxMatches: { type: 'number' }, maxFileBytes: { type: 'number' } } } } },
          { type: 'function', function: { name: 'upsert_file', description: 'Create or overwrite a file with given content', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
          { type: 'function', function: { name: 'append_file', description: 'Append content to a file (creates if missing)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
          { type: 'function', function: { name: 'make_dir', description: 'Create a directory (recursive)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
        ],
        instructions: `You are an AI programming assistant embedded in VS Code.\nYour primary role is to help users write code by providing intelligent code completions and suggestions.\nAnalyze the code context provided and generate relevant, high-quality code completions.\nFocus on producing working, efficient, and idiomatic code in the language being used.\nWhen possible, follow the coding style evident in the existing code.\nKeep your responses focused on code completion unless specifically asked for explanations.\n\nIMPORTANT: When working with files, always use relative paths from the workspace root. The workspace root is the project directory that the user has open in VS Code, not the extension directory.`
      }, apiKey);
      } catch (e: any) {
        const msg = e?.message || '';
        if (/cannot be used with the Assistants API/i.test(msg)) {
          const fallbackModel = 'gpt-4o-mini';
          response = await this.makeRequest('POST', '/assistants', {
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
            ],
            instructions: `You are an AI programming assistant embedded in VS Code.\nYour primary role is to help users write code by providing intelligent code completions and suggestions.\nAnalyze the code context provided and generate relevant, high-quality code completions.\nFocus on producing working, efficient, and idiomatic code in the language being used.\nWhen possible, follow the coding style evident in the existing code.\nKeep your responses focused on code completion unless specifically asked for explanations.\n\nIMPORTANT: When working with files, always use relative paths from the workspace root. The workspace root is the project directory that the user has open in VS Code, not the extension directory.`
          }, apiKey);
        } else { throw e; }
      }

      const assistantId = response.id;
      this.configService.setAssistantId(assistantId);
      return assistantId;
    } catch (error: any) {
      console.error('Error creating assistant:', error.message);
      throw new Error(`Failed to create OpenAI assistant: ${error.message}`);
    }
  }

  private async createThread(apiKey: string): Promise<string> {
    try {
      const response = await this.makeRequest('POST', '/threads', {}, apiKey);
      return response.id;
    } catch (error: any) {
      console.error('Error creating thread:', error.message);
      throw new Error(`Failed to create thread: ${error.message}`);
    }
  }

  public async getCompletion(codeContext: string, language: string): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey || !this.assistantId || !this.threadId) {
      await this.initialize();
      if (!apiKey || !this.assistantId || !this.threadId) throw new Error('OpenAI Agent not properly initialized');
    }
    try {
      await this.makeRequest('POST', `/threads/${this.threadId}/messages`, {
        role: 'user',
        content: [{ type: 'text', text: `I'm writing code in ${language}. Here's the context\n\n${codeContext}\n\nPlease complete the next part of the code.` }]
      }, apiKey);
      const runResponse = await this.makeRequest('POST', `/threads/${this.threadId}/runs`, { assistant_id: this.assistantId }, apiKey);
      const runId = runResponse.id;
      return await this.waitForRunCompletion(apiKey, runId);
    } catch (error: any) {
      console.error('OpenAI API Error:', error.message);
      throw new Error(`OpenAI API Error: ${error.message}`);
    }
  }

  public async chat(userMessage: string, onThinking?: (step: string) => void): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey || !this.assistantId || !this.threadId) {
      await this.initialize();
      if (!apiKey || !this.assistantId || !this.threadId) throw new Error('OpenAI Agent not properly initialized');
    }
    try {
      await this.makeRequest('POST', `/threads/${this.threadId}/messages`, { role: 'user', content: [{ type: 'text', text: userMessage }] }, apiKey);
      const runResponse = await this.makeRequest('POST', `/threads/${this.threadId}/runs`, { assistant_id: this.assistantId }, apiKey);
      const runId = runResponse.id;
      this.currentRunId = runId;
      try {
        return await this.waitForRunCompletion(apiKey, runId, onThinking);
      } finally {
        this.currentRunId = undefined;
      }
    } catch (e: any) {
      this.currentRunId = undefined;
      throw new Error(e?.message || String(e));
    }
  }

  private async waitForRunCompletion(apiKey: string, runId: string, onThinking?: (step: string) => void): Promise<string> {
    const maxAttempts = 60;
    const delayMs = 1000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.makeRequest('GET', `/threads/${this.threadId}/runs/${runId}`, undefined, apiKey);
        const status = response.status;
        if (status === 'requires_action') {
          const toolCalls = response.required_action?.submit_tool_outputs?.tool_calls || [];
          const outputs: Array<{ tool_call_id: string; output: string }> = [];
          
          if (onThinking && toolCalls.length > 0) {
            onThinking(`AI decided to use tools: ${toolCalls.map((call: any) => call.function?.name).join(', ')}`);
          }
          
          for (const call of toolCalls) {
            const name = call.function?.name;
            const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
            
            if (onThinking) {
              let toolDescription = `Executing ${name}`;
              if (name === 'read_file' && args.path) {
                toolDescription += ` - reading file: ${args.path}`;
              } else if (name === 'search_workspace' && args.query) {
                toolDescription += ` - searching for: "${args.query}"`;
              } else if (name === 'upsert_file' && args.path) {
                toolDescription += ` - writing to file: ${args.path}`;
              }
              onThinking(toolDescription);
            }
            
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
          
          if (onThinking) {
            onThinking('Processing tool results...');
          }
          
          await this.makeRequest('POST', `/threads/${this.threadId}/runs/${runId}/submit_tool_outputs`, { tool_outputs: outputs }, apiKey);
        } else if (status === 'completed') {
          if (onThinking) {
            onThinking('Generating final response...');
          }
          
          // Get usage information and calculate cost
          const usage = response.usage;
          if (usage) {
            // Get the actual model used from the response, fallback to config if not available
            const model = response.model || this.configService.getModel();
            const cost = this.calculateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
            this.sessionCost += cost;
            
            console.log('Cost calculation:', {
              model: model,
              inputTokens: usage.prompt_tokens || 0,
              outputTokens: usage.completion_tokens || 0,
              cost: cost,
              totalCost: this.sessionCost,
              responseModel: response.model,
              configModel: this.configService.getModel()
            });
            
            // Send cost information to the UI
            if (this._view) {
              this._view.webview.postMessage({ 
                type: 'costUpdate', 
                cost: cost,
                totalCost: this.sessionCost,
                tokens: {
                  input: usage.prompt_tokens || 0,
                  output: usage.completion_tokens || 0,
                  total: usage.total_tokens || 0
                },
                model: model
              });
            }
          }
          
          return await this.getLastAssistantMessage(apiKey);
        } else if (status === 'failed' || status === 'cancelled' || status === 'expired') {
          throw new Error(`Run ${status}: ${response.last_error?.message || 'Unknown error'}`);
        } else if (status === 'in_progress' || status === 'queued') {
          if (onThinking) {
            // Get more detailed status information
            const runDetails = response;
            let thinkingText = `Processing... (${status})`;
            
            if (runDetails.required_action) {
              thinkingText = `AI is deciding what tools to use...`;
            } else if (runDetails.last_error) {
              thinkingText = `Error occurred: ${runDetails.last_error.message}`;
            } else if (runDetails.started_at && !runDetails.completed_at) {
              const elapsed = Math.floor((Date.now() - new Date(runDetails.started_at).getTime()) / 1000);
              thinkingText = `AI is thinking... (${elapsed}s elapsed)`;
            }
            
            onThinking(thinkingText);
          }
          
          // Try to get intermediate messages to show thinking process
          if (onThinking && status === 'in_progress') {
            try {
              const messagesResponse = await this.makeRequest('GET', `/threads/${this.threadId}/messages?limit=5&order=desc`, undefined, apiKey);
              
              if (messagesResponse.data && messagesResponse.data.length > 0) {
                const lastMessage = messagesResponse.data[0];
                if (lastMessage.role === 'assistant' && lastMessage.content) {
                  let thinkingText = '';
                  for (const contentItem of lastMessage.content) {
                    if (contentItem.type === 'text') {
                      thinkingText += contentItem.text.value;
                    }
                  }
                  if (thinkingText.trim() && thinkingText.length > 10) {
                    onThinking(`AI reasoning: ${thinkingText.substring(0, 200)}${thinkingText.length > 200 ? '...' : ''}`);
                  }
                }
              }
            } catch (e) {
              // Ignore errors when trying to get intermediate messages
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error: any) {
        console.error('Error checking run status:', error.message);
        throw new Error(`Error checking completion status: ${error.message}`);
      }
    }
    throw new Error('Timed out waiting for completion');
  }

  private async getLastAssistantMessage(apiKey: string): Promise<string> {
    try {
      const response = await this.makeRequest('GET', `/threads/${this.threadId}/messages?limit=1&order=desc`, undefined, apiKey);
      if (response.data && response.data.length > 0) {
        const message = response.data[0];
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
      console.error('Error retrieving messages:', error.message);
      throw new Error(`Error retrieving completion: ${error.message}`);
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
      const response = await this.makeRequest('GET', `/threads/${threadId}/messages?limit=100&order=asc`, undefined, apiKey);

      if (response.data && response.data.length > 0) {
        const messages: Array<{role: string, content: string}> = [];
        
        for (const message of response.data) {
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
      console.error('Error retrieving thread history:', error.message);
      throw new Error(`Failed to retrieve thread history: ${error.message}`);
    }
  }

  public getActiveThreadId(): string | undefined {
    return this.configService.getActiveThreadId();
  }

  public async cancelCurrentRun(): Promise<void> {
    if (this.currentRunId && this.threadId) {
      try {
        const apiKey = await this.configService.getApiKey();
        if (apiKey) {
          await this.makeRequest('POST', `/threads/${this.threadId}/runs/${this.currentRunId}/cancel`, {}, apiKey);
          console.log(`Cancelled run ${this.currentRunId}`);
        }
      } catch (error: any) {
        console.warn('Failed to cancel run:', error?.message || error);
      } finally {
        this.currentRunId = undefined;
      }
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
      console.error('Error resetting thread:', error.message);
      throw new Error(`Failed to reset thread: ${error.message}`);
    }
  }

  public async updateAssistantModel(): Promise<void> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    
    const newModel = this.configService.getModel();
    console.log('updateAssistantModel called - newModel:', newModel);
    
    // Always create a new assistant when model changes
    // This ensures the new model is used
    console.log('Creating new assistant with model:', newModel);
    await this.configService.setAssistantId('');
    this.assistantId = await this.getOrCreateAssistant(apiKey);
    console.log('New assistant created with model:', newModel, 'ID:', this.assistantId);
  }
}
