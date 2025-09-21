import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { ConfigurationService } from './configurationService';

export class OpenAIService {
  private client: AxiosInstance;
  private configService: ConfigurationService;
  private assistantId: string | undefined;
  private threadId: string | undefined;
  
  constructor(configService: ConfigurationService) {
    this.configService = configService;
    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v1'
      }
    });
  }
  
  public async initialize(): Promise<void> {
    try {
      const apiKey = await this.configService.getApiKey();
      if (!apiKey) {
        throw new Error('OpenAI API key is not set');
      }
      
      // Create or retrieve assistant
      this.assistantId = await this.getOrCreateAssistant(apiKey);
      
      // Create a new thread
      this.threadId = await this.createThread(apiKey);
      
      vscode.window.showInformationMessage('OpenAI Agent initialized successfully');
    } catch (error: any) {
      console.error('Failed to initialize OpenAI service:', error);
      vscode.window.showErrorMessage(`Failed to initialize OpenAI Agent: ${error.message}`);
      throw error;
    }
  }
  
  private async getOrCreateAssistant(apiKey: string): Promise<string> {
    // Try to retrieve saved assistant ID
    const savedAssistantId = this.configService.getAssistantId();
    
    if (savedAssistantId) {
      try {
        // Check if the assistant still exists
        await this.client.get(`/assistants/${savedAssistantId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return savedAssistantId;
      } catch (error) {
        console.log('Saved assistant not found, creating a new one');
      }
    }
    
    // Create a new assistant
    try {
      const response = await this.client.post('/assistants', {
        name: 'VS Code Coding Assistant',
        description: 'An AI assistant that helps with coding in VS Code',
        model: this.configService.getModel(),
        tools: [{ type: "code_interpreter" }],
        instructions: `You are an AI programming assistant embedded in VS Code. 
        Your primary role is to help users write code by providing intelligent code completions and suggestions.
        Analyze the code context provided and generate relevant, high-quality code completions.
        Focus on producing working, efficient, and idiomatic code in the language being used.
        When possible, follow the coding style evident in the existing code.
        Keep your responses focused on code completion unless specifically asked for explanations.`
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
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
      const response = await this.client.post('/threads', {}, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
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
      if (!apiKey || !this.assistantId || !this.threadId) {
        throw new Error('OpenAI Agent not properly initialized');
      }
    }
    
    try {
      // Add a message to the thread
      await this.client.post(`/threads/${this.threadId}/messages`, {
        role: 'user',
        content: `I'm writing code in ${language}. Here's the context:\n\n${codeContext}\n\nPlease complete the next part of the code.`
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      // Run the assistant
      const runResponse = await this.client.post(`/threads/${this.threadId}/runs`, {
        assistant_id: this.assistantId
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      const runId = runResponse.data.id;
      
      // Poll for completion
      return await this.waitForRunCompletion(apiKey, runId);
    } catch (error: any) {
      console.error('OpenAI API Error:', error.response?.data || error.message);
      throw new Error(`OpenAI API Error: ${error.response?.data?.error?.message || error.message}`);
    }
  }
  
  private async waitForRunCompletion(apiKey: string, runId: string): Promise<string> {
    const maxAttempts = 30;
    const delayMs = 1000;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(`/threads/${this.threadId}/runs/${runId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        const status = response.data.status;
        
        if (status === 'completed') {
          return await this.getLastAssistantMessage(apiKey);
        } else if (status === 'failed' || status === 'cancelled' || status === 'expired') {
          throw new Error(`Run ${status}: ${response.data.last_error?.message || 'Unknown error'}`);
        }
        
        // Wait before checking again
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
      const response = await this.client.get(`/threads/${this.threadId}/messages`, {
        params: { limit: 1, order: 'desc' },
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (response.data.data && response.data.data.length > 0) {
        const message = response.data.data[0];
        if (message.role === 'assistant' && message.content && message.content.length > 0) {
          // Extract text content from the message
          let textContent = '';
          for (const contentItem of message.content) {
            if (contentItem.type === 'text') {
              textContent += contentItem.text.value;
            }
          }
          
          // Try to extract code blocks if present
          const codeBlockRegex = /```(?:\w+)?\s*([\s\S]*?)```/g;
          const matches = [...textContent.matchAll(codeBlockRegex)];
          
          if (matches.length > 0) {
            // Return just the code from the first code block
            return matches[0][1].trim();
          }
          
          // If no code blocks, return the raw text with some cleanup
          return textContent
            .replace(/^I'll complete the next part of the code[:.]\s*/i, '')
            .replace(/^Here's the completion[:.]\s*/i, '')
            .trim();
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
    if (!apiKey) {
      throw new Error('OpenAI API key is not set');
    }
    
    try {
      // Create a new thread
      this.threadId = await this.createThread(apiKey);
    } catch (error: any) {
      console.error('Error resetting thread:', error.response?.data || error.message);
      throw new Error(`Failed to reset thread: ${error.response?.data?.error?.message || error.message}`);
    }
  }
}
