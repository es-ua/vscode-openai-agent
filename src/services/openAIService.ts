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

  constructor(configService: ConfigurationService, basePath: string) {
    this.configService = configService;
    this.basePath = basePath;
    this.baseURL = 'https://api.openai.com/v1';
  }

  private authHeaders(apiKey: string) {
    return { 'Authorization': `Bearer ${apiKey}`, 'OpenAI-Beta': 'assistants=v2' };
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
        await this.makeRequest('GET', `/assistants/${savedAssistantId}`, undefined, apiKey);
        return savedAssistantId;
      } catch {
        // will create a new one below
      }
    }

    try {
      let response;
      try {
        response = await this.makeRequest('POST', '/assistants', {
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
            ]
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
}
