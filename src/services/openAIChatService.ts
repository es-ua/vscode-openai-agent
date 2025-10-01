import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { RAGManager } from './rag/ragManager';
import { RelevantContext, Decision, SearchResult } from '../types/rag';
import { v4 as uuidv4 } from 'uuid';

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  metadata?: {
    audioId?: string;
    filename?: string;
    audioPath?: string;
    description?: string;
    [key: string]: any;
  };
}

interface ChatThread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIChatService {
  private apiKey: string;
  private model: string;
  private ragManager: RAGManager;
  private currentThread: ChatThread | null = null;
  private threads: Map<string, ChatThread> = new Map();
  private storageDir: string;
  private chatHistoryDir: string;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
    this.storageDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.chatHistoryDir = path.join(this.storageDir, '.vscode', 'openai-agent', 'chats');
    this.ragManager = new RAGManager(this.storageDir, apiKey);
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing OpenAI Chat Service...');
      await fs.promises.mkdir(this.chatHistoryDir, { recursive: true });
      await this.ragManager.initialize();
      await this.loadThreads();
      console.log('OpenAI Chat Service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OpenAI Chat Service:', error);
      throw error;
    }
  }

  private generateId(): string {
    return uuidv4();
  }

  private async loadThreads(): Promise<void> {
    this.threads.clear();
    try {
      const files = await fs.promises.readdir(this.chatHistoryDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.promises.readFile(path.join(this.chatHistoryDir, file), 'utf8');
          const thread: ChatThread = JSON.parse(content);
          this.threads.set(thread.id, thread);
        }
      }
      // Set the most recently updated thread as active
      if (this.threads.size > 0) {
        const sortedThreads = Array.from(this.threads.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        this.currentThread = sortedThreads[0];
        console.log('Loaded threads. Active thread:', this.currentThread.id);
      } else {
        console.log('No existing threads found. A new one will be created on first chat.');
      }
    } catch (error) {
      console.error('Error loading chat threads:', error);
    }
  }

  private async saveThread(thread: ChatThread): Promise<void> {
    thread.updatedAt = new Date().toISOString();
    
    // Обновляем thread в Map чтобы изменения (включая название) были видны сразу
    this.threads.set(thread.id, thread);
    
    // Сохраняем на диск
    await fs.promises.writeFile(
      path.join(this.chatHistoryDir, `${thread.id}.json`),
      JSON.stringify(thread, null, 2),
      'utf8'
    );
  }

  async newThread(): Promise<string> {
    const thread: ChatThread = {
      id: this.generateId(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.threads.set(thread.id, thread);
    this.currentThread = thread;
    await this.saveThread(thread);
    console.log('New thread created:', thread.id);
    return thread.id;
  }

  getThreadInfo(): { threads: string[]; active: string | undefined; threadNames: { [id: string]: string } } {
    const threadNames: { [id: string]: string } = {};
    this.threads.forEach(thread => {
      threadNames[thread.id] = thread.title;
    });
    return {
      threads: Array.from(this.threads.keys()),
      active: this.currentThread?.id,
      threadNames: threadNames,
    };
  }

  async getThreadHistory(threadId: string): Promise<Message[]> {
    const thread = this.threads.get(threadId);
    return thread ? thread.messages : [];
  }

  async setActiveThread(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) {
      this.currentThread = thread;
      console.log('Active thread set to:', threadId);
    } else {
      throw new Error(`Thread with ID ${threadId} not found.`);
    }
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.title = name;
      await this.saveThread(thread);
      console.log(`Thread ${threadId} renamed to: ${name}`);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (this.threads.has(threadId)) {
      this.threads.delete(threadId);
      
      // Delete the thread file
      const threadFile = path.join(this.storageDir, '.vscode', 'openai-agent', 'threads', `${threadId}.json`);
      try {
        await fs.promises.unlink(threadFile);
      } catch (error) {
        console.warn(`Could not delete thread file: ${threadFile}`, error);
      }
      
      // If this was the active thread, switch to another one
      if (this.currentThread?.id === threadId) {
        const remainingThreads = Array.from(this.threads.keys());
        if (remainingThreads.length > 0) {
          this.currentThread = this.threads.get(remainingThreads[0]);
        } else {
          this.currentThread = undefined;
        }
      }
      
      console.log(`Thread ${threadId} deleted`);
    }
  }

  async getThreads(): Promise<string[]> {
    return Array.from(this.threads.keys());
  }

  private async generateThreadTitle(thread: ChatThread, firstMessage: string): Promise<void> {
    try {
      // Генерируем короткое название на основе первого сообщения
      const titlePrompt = `Generate a short, concise title (3-6 words max) for a chat that starts with this message. Return ONLY the title, nothing else:\n\n"${firstMessage.substring(0, 200)}"`;
      
      const response = await this.makeRequest('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: 'You generate short, concise chat titles. Return only the title, no quotes, no punctuation at the end.' },
          { role: 'user', content: titlePrompt }
        ],
        temperature: 0.7,
        max_tokens: 50,
      });

      let title = response.choices[0].message.content?.trim() || 'New Chat';
      
      // Убираем кавычки если есть
      title = title.replace(/^["']|["']$/g, '');
      
      // Ограничиваем длину
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }
      
      thread.title = title;
      await this.saveThread(thread);
      console.log(`Generated thread title: ${title}`);
    } catch (error) {
      console.error('Error generating thread title:', error);
      // Если не удалось сгенерировать, создаём простое название
      const simpleTitle = firstMessage.substring(0, 40).trim();
      thread.title = simpleTitle.length < firstMessage.length ? simpleTitle + '...' : simpleTitle;
      await this.saveThread(thread);
    }
  }

  async chat(prompt: string, onThinking?: (step: string) => void): Promise<string> {
    try {
      const thread = await this.getCurrentThread();
      const isFirstMessage = thread.messages.length === 0;

      const userMessage: Message = {
        role: 'user',
        content: prompt,
      };

      thread.messages.push(userMessage);
      await this.saveThread(thread);

      await this.ragManager.addChatMessage({
        id: this.generateId(),
        content: prompt,
        chatId: thread.id,
        timestamp: new Date().toISOString(),
      });

      if (onThinking) onThinking('Retrieving relevant context...');
      const relevantContext = await this.ragManager.getRelevantContext(prompt, thread.id);
      
      if (onThinking) onThinking('Preparing response...');
      const contextMessages = this.prepareContextWithRAG(thread, relevantContext);

      const response = await this.makeRequest('/chat/completions', {
        model: this.model,
        messages: contextMessages,
        temperature: 0.7,
        max_tokens: 4000,
      }, onThinking);

      const assistantResponseContent = response.choices[0].message.content || '';
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantResponseContent,
      };
      thread.messages.push(assistantMessage);
      await this.saveThread(thread);

      await this.ragManager.addChatMessage({
        id: this.generateId(),
        content: assistantMessage.content,
        chatId: thread.id,
        timestamp: new Date().toISOString(),
      });

      // Автоматически генерируем название для нового чатика
      if (isFirstMessage && thread.title === 'New Chat') {
        await this.generateThreadTitle(thread, prompt);
      }

      return assistantResponseContent;
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    }
  }

  async addImage(imageData: Buffer, description: string): Promise<string> {
    const thread = await this.getCurrentThread();
    const imageId = await this.ragManager.addImageMessage(imageData, thread.id);
    // Optionally add a message to the chat history about the image
    const imageMessage: Message = {
      role: 'user', // Or a special 'image' role if supported by UI
      content: `[Image: ${description}]`,
    };
    thread.messages.push(imageMessage);
    await this.saveThread(thread);
    return imageId;
  }

  async addAudio(audioData: Buffer, filename: string, description: string): Promise<string> {
    const thread = await this.getCurrentThread();
    const audioId = await this.ragManager.addAudioMessage(audioData, thread.id);
    
    // Сохраняем аудиофайл на диск для последующей транскрипции по запросу
    const audioDir = path.join(this.storageDir, '.vscode', 'openai-agent', 'audio');
    await fs.promises.mkdir(audioDir, { recursive: true});
    const audioPath = path.join(audioDir, `${audioId}_${filename}`);
    await fs.promises.writeFile(audioPath, audioData);
    
    // Add a message to the chat history about the audio with metadata
    const audioMessage: Message = {
      role: 'user',
      content: `[Audio: ${description}]`,
      metadata: {
        audioId: audioId,
        filename: filename,
        audioPath: audioPath,
        description: description
      }
    };
    thread.messages.push(audioMessage);
    await this.saveThread(thread);
    return audioId;
  }

  // Новый метод: транскрибировать аудио по имени файла из текущего thread
  async transcribeAudioByFilename(filename: string, language?: string, onProgress?: (progress: number) => void): Promise<string> {
    const thread = await this.getCurrentThread();
    
    // Ищем сообщение с этим аудиофайлом
    const audioMessage = thread.messages.find(msg => 
      msg.metadata && 
      msg.metadata.filename === filename
    );
    
    if (!audioMessage || !audioMessage.metadata?.audioPath) {
      throw new Error(`Audio file "${filename}" not found in current conversation`);
    }
    
    // Читаем файл с диска
    const audioPath = audioMessage.metadata.audioPath;
    const audioData = await fs.promises.readFile(audioPath);
    
    // Транскрибируем
    return this.transcribeAudio(audioData, filename, language, onProgress);
  }
  
  async transcribeAudio(audioData: Buffer, filename: string, language?: string, onProgress?: (progress: number) => void): Promise<string> {
    try {
      // Create a temporary file for the audio data
      const tempDir = path.join(this.storageDir, '.vscode', 'openai-agent', 'temp');
      await fs.promises.mkdir(tempDir, { recursive: true });
      
      const tempFilePath = path.join(tempDir, `audio_${Date.now()}.${this.getFileExtension(filename)}`);
      await fs.promises.writeFile(tempFilePath, audioData);

      // Show real progress stages instead of fake simulation
      if (onProgress) {
        onProgress(0); // Starting
      }

      // Prepare form data for Whisper API
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFilePath));
      form.append('model', 'whisper-1');
      if (language) {
        form.append('language', language);
      }

      // Show upload progress
      if (onProgress) {
        onProgress(25); // File prepared, starting upload
      }

      // Make request to Whisper API
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            ...form.getHeaders(),
          },
        }
      );

      // Show processing complete
      if (onProgress) {
        onProgress(75); // Upload complete, processing...
      }

      // Clean up temporary file
      await fs.promises.unlink(tempFilePath);

      const transcription = (response.data as any).text;
      
      // Show final progress
      if (onProgress) {
        onProgress(100); // Complete
      }
      
      // Add transcription to current thread
      const thread = await this.getCurrentThread();
      const transcriptionMessage: Message = {
        role: 'user',
        content: `[Audio Transcription: ${filename}]\n${transcription}`,
      };
      thread.messages.push(transcriptionMessage);
      await this.saveThread(thread);

      return transcription;
    } catch (error: any) {
      console.error('Error transcribing audio:', error);
      throw new Error(`Audio transcription failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : 'mp3';
  }

  async addDecision(decision: Omit<Decision, 'id' | 'timestamp'>): Promise<void> {
    const fullDecision: Decision = {
      ...decision,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
    };
    await this.ragManager.addDecision(fullDecision);
  }

  async getRelevantDecisions(query: string): Promise<Decision[]> {
    return this.ragManager.getAllDecisions(); // For now, return all. RAG search can be integrated later.
  }

  async searchContext(query: string): Promise<SearchResult[]> {
    return this.ragManager.search(query, { limit: 20 });
  }

  async indexWorkspaceCode(): Promise<void> {
    return this.ragManager.indexWorkspace();
  }

  async getCurrentThread(): Promise<ChatThread> {
    if (!this.currentThread) {
      await this.newThread();
    }
    return this.currentThread!;
  }

  private prepareContextWithRAG(thread: ChatThread, relevantContext: RelevantContext): Message[] {
    let systemPrompt = `You are an AI programming assistant embedded in VS Code with advanced code execution, debugging, and mobile development capabilities.\n\n`;

    if (relevantContext.code.length > 0) {
      systemPrompt += `RELEVANT CODE CONTEXT:\n`;
      relevantContext.code.forEach(code => {
        systemPrompt += `File: ${code.path} (Lines ${code.startLine || 0}-${code.endLine || 0})\n\`\`\`\n${code.content}\n\`\`\`\n`;
      });
    }

    if (relevantContext.decisions.length > 0) {
      systemPrompt += `PREVIOUS DECISIONS:\n`;
      relevantContext.decisions.forEach(decision => {
        systemPrompt += `- ${decision.title}: ${decision.description}\n`;
      });
    }

    if (relevantContext.chatHistory.length > 0) {
      systemPrompt += `RELEVANT PREVIOUS DISCUSSIONS:\n`;
      relevantContext.chatHistory.forEach(chat => {
        systemPrompt += `- ${chat.content}\n`;
      });
    }

    if (relevantContext.images && relevantContext.images.length > 0) {
      systemPrompt += `RELEVANT IMAGES:\n`;
      relevantContext.images.forEach((image: any) => {
        systemPrompt += `- ${image.description}\n`;
      });
    }

    systemPrompt += `\n🖼️ IMAGE PROCESSING CAPABILITIES:
- You CAN view and analyze images directly through this VS Code extension
- Users can upload images (PNG, JPG, GIF, etc. up to 25MB) using the image upload button (🖼️) or drag & drop
- Images will appear as [Image: filename] in the chat
- You have full vision capabilities and can see, analyze, describe, and understand images
- NEVER say you cannot see or process images - you have complete image analysis capabilities
- When users upload an image, you can see its contents and answer questions about it

🎵 AUDIO PROCESSING CAPABILITIES:
- You CAN process audio files directly through this VS Code extension
- Users can upload MP3, MP4, and M4A files (up to 25MB) using the audio upload button (🎵) or drag & drop
- Audio files will appear as [Audio: filename.mp3] in the chat
- Audio files are NOT automatically transcribed - transcription happens only when user explicitly requests it
- When user asks to transcribe/analyze audio content:
  * Respond: "Начинаю транскрипцию аудиофайла [filename]..."
  * Internally trigger transcription (system will handle this automatically when you mention transcription)
  * The transcription will appear in chat automatically with progress indicator
  * After transcription completes, analyze the resulting text based on user's request
- NEVER say you cannot process audio files - you have full audio processing capabilities through Whisper API
- Example flow:
  User: "расшифруй аудио voice.mp3"
  You: "Начинаю транскрипцию аудиофайла voice.mp3..."
  [System shows progress and transcription result]
  You: [Analyze the transcription result]

📎 FILE PROCESSING CAPABILITIES:
- You CAN work with various file types: images, audio, PDF, text files, and more
- Users can upload files using buttons or drag & drop (up to 25MB)
- Files will appear as [Image: ...], [Audio: ...], [PDF: ...], [Text: ...], or [File: ...]
- You have access to file contents and can analyze them based on their type

⚠️ CRITICAL INSTRUCTION: YOU CAN DIRECTLY EXECUTE ANY TERMINAL COMMAND using run_command. NEVER tell users you cannot run commands. ALWAYS use run_command to execute commands directly instead of giving manual instructions.`;

    const systemMessage: Message = {
      role: 'system',
      content: systemPrompt,
    };

    const recentMessages = thread.messages.slice(-10); // Get last 10 messages for short-term context

    return [systemMessage, ...recentMessages];
  }

  private async makeRequest(endpoint: string, data: any, onThinking?: (step: string) => void): Promise<ChatResponse> {
    try {
      if (onThinking) onThinking('Sending request to OpenAI...');
      
      const response = await axios.post<ChatResponse>(
        `https://api.openai.com/v1${endpoint}`,
        data,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (onThinking) onThinking('Processing response...');
      return response.data;
    } catch (error: any) {
      console.error('Error making OpenAI API request:', error.response?.data || error.message);
      throw new Error(`OpenAI API request failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  // Метод для совместимости с интерфейсом
  setView(view: vscode.WebviewView): void {
    // Для Chat Completions API не требуется хранить view
  }

  // Метод для получения подсказок кода
  async getCompletion(context: string, language: string): Promise<string | null> {
    try {
      const prompt = `Complete this code (language: ${language}):\n\n${context}\n\n`;
      const completion = await this.chat(prompt);
      
      // Extract code from the response (remove markdown code blocks if present)
      let result = completion;
      const codeBlockMatch = completion.match(/```(?:\w+)?\n([\s\S]+?)\n```/);
      if (codeBlockMatch) {
        result = codeBlockMatch[1];
      }
      
      return result;
    } catch (error) {
      console.error('Error getting completion:', error);
      return null;
    }
  }
}
