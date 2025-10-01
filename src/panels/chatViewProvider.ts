import * as vscode from 'vscode';
import { OpenAIServiceInterface } from '../services/openAIServiceInterface';
import { ConfigurationService } from '../services/configurationService';
import { PermissionService } from '../services/permissionService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'openaiAgent.chatView';
  public static readonly panelViewId = 'openaiAgent.panelView';
  private _view?: vscode.WebviewView;
  private openAI: OpenAIServiceInterface;
  private configService: ConfigurationService;
  private permissionService?: PermissionService;
  private extensionUri: vscode.Uri;
  private isProcessing: boolean = false;

  constructor(openAI: OpenAIServiceInterface, configService: ConfigurationService, extensionUri: vscode.Uri) {
    this.openAI = openAI;
    this.configService = configService;
    this.extensionUri = extensionUri;
    // PermissionService will be initialized in resolveWebviewView
  }

  private sendMessage(type: string, data: any) {
    if (this._view) {
      this._view.webview.postMessage({ type, ...data });
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this._view = webviewView;
    
    // Получаем настройку языка транскрипции
    const config = vscode.workspace.getConfiguration('openaiAgent');
    const transcriptionLanguage = config.get<string>('audio.transcriptionLanguage', '');
    webviewView.webview.postMessage({ 
      type: 'setTranscriptionLanguage', 
      language: transcriptionLanguage 
    });
    this.openAI.setView(webviewView);
    
    // Get permission service after OpenAIService is initialized
    this.permissionService = this.openAI.getPermissionService();
    
    // Send initial permission stats
    if (this.permissionService) {
      const stats = this.permissionService.getPermissionStats();
      console.log('Sending initial permission stats:', stats);
      webviewView.webview.postMessage({ type: 'permissionStats', stats });
    }
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    const postThreads = async () => {
      console.log('postThreads called');
      const info = this.openAI.getThreadInfo();
      console.log('Thread info received:', info);
      webviewView.webview.postMessage({ type: 'threads', info });
      
      // Load history for active thread with a small delay to avoid conflicts
      if (info.active) {
        console.log('Loading history for active thread:', info.active);
        const activeThreadId = info.active;
        setTimeout(async () => {
          try {
            const history = await this.openAI.getThreadHistory(activeThreadId);
            console.log('Thread history loaded:', history);
            webviewView.webview.postMessage({ type: 'loadHistory', history });
          } catch (error: any) {
            console.error('Failed to load thread history:', error);
            webviewView.webview.postMessage({ type: 'error', message: 'Failed to load chat history' });
          }
        }, 100);
      } else {
        console.log('No active thread found');
      }
    };

    try { await this.openAI.initialize(); } catch {}
    
    // Check if we have any threads, if not create one
    const info = this.openAI.getThreadInfo();
    console.log('Initial thread info:', info);
    if (!info.threads || info.threads.length === 0) {
      console.log('No threads found, creating new thread');
      try {
        const newThreadId = await this.openAI.newThread();
        console.log('New thread created with ID:', newThreadId);
      } catch (error) {
        console.error('Failed to create initial thread:', error);
      }
    } else if (!info.active && info.threads.length > 0) {
      // If we have threads but no active one, set the last one as active
      console.log('No active thread, setting last thread as active');
      try {
        await this.openAI.setActiveThread(info.threads[info.threads.length - 1]);
        console.log('Active thread set to:', info.threads[info.threads.length - 1]);
      } catch (error) {
        console.error('Failed to set active thread:', error);
      }
    }
    
    await postThreads();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        postThreads();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      console.log('Received message from webview:', msg.type);
      
      if (msg.type === 'sendPrompt') {
        // Убираем проверку isProcessing - позволяем множественные запросы
        webviewView.webview.postMessage({ type: 'thinking', content: 'Thinking...' });
        
        try {
          const response = await this.openAI.chat(msg.prompt, (step) => {
            webviewView.webview.postMessage({ type: 'updateThinking', content: step });
          });
          console.log('Chat response received:', response);
          
          // Проверяем, нужно ли транскрибировать аудиофайл
          // Ищем упоминание транскрипции в ответе AI
          const transcriptionKeywords = /(транскрипц|расшифр|расшифруй|расшифровать)/i;
          const hasTranscriptionRequest = transcriptionKeywords.test(response);
          
          if (hasTranscriptionRequest) {
            // Ищем аудиофайлы в текущем thread
            const thread = await this.openAI.getCurrentThread();
            const audioMessages = thread.messages.filter(msg => 
              msg.metadata && 
              msg.metadata.filename && 
              /\.(mp3|m4a|mp4|wav|ogg)$/i.test(msg.metadata.filename)
            );
            
            if (audioMessages.length > 0) {
              // Берём последний загруженный аудиофайл
              const lastAudio = audioMessages[audioMessages.length - 1];
              const filename = lastAudio.metadata.filename;
              
              console.log(`Detected transcription request for: ${filename}`);
              
              // Отправляем ответ AI БЕЗ сброса кнопки (транскрипция идёт)
              console.log('Sending AI response with keepProcessing: true');
              webviewView.webview.postMessage({ 
                type: 'append', 
                role: 'assistant', 
                content: response,
                keepProcessing: true // Флаг что транскрипция идёт
              });
              
              // Запускаем транскрипцию
              try {
                const config = vscode.workspace.getConfiguration('openaiAgent');
                const transcriptionLanguage = config.get<string>('audio.transcriptionLanguage') || undefined;
                
                const transcription = await this.openAI.transcribeAudioByFilename(
                  filename,
                  transcriptionLanguage,
                  (progress: number) => {
                    webviewView.webview.postMessage({
                      type: 'transcriptionProgress',
                      progress: progress,
                      filename: filename
                    });
                  }
                );
                
                // Результат транскрипции - теперь можно сбросить кнопку
                console.log('Sending transcription result with keepProcessing: false');
                webviewView.webview.postMessage({
                  type: 'append',
                  role: 'assistant',
                  content: `📝 Транскрипция файла "${filename}":\n\n${transcription}`,
                  keepProcessing: false // Завершаем обработку
                });
              } catch (transcribeError: any) {
                console.error('Auto-transcription error:', transcribeError);
                webviewView.webview.postMessage({ 
                  type: 'error', 
                  message: `Ошибка транскрипции: ${transcribeError.message}`,
                  keepProcessing: false // Сбрасываем кнопку при ошибке
                });
              }
            } else {
              // Нет аудиофайлов для транскрипции
              console.log('Transcription requested but no audio files found');
              webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: response });
            }
          } else {
            // Обычный ответ без транскрипции
            webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: response });
          }
          
          // Обновляем список потоков (название могло измениться)
          postThreads();
        } catch (error: any) {
          console.error('Error in chat:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'newThread') {
        try {
          const threadId = await this.openAI.newThread();
          postThreads();
        } catch (error: any) {
          console.error('Error creating new thread:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'setActiveThread') {
        try {
          await this.openAI.setActiveThread(msg.threadId);
          const history = await this.openAI.getThreadHistory(msg.threadId);
          webviewView.webview.postMessage({ type: 'loadHistory', history });
          postThreads();
        } catch (error: any) {
          console.error('Error setting active thread:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'renameThread') {
        try {
          await this.openAI.setThreadName(msg.threadId, msg.name);
          postThreads();
        } catch (error: any) {
          console.error('Error renaming thread:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'deleteThread') {
        try {
          await this.openAI.deleteThread(msg.threadId);
          postThreads();
          // If we deleted the current thread, create a new one
          const threads = await this.openAI.getThreads();
          if (threads.length === 0) {
            await this.openAI.newThread();
            postThreads();
          }
        } catch (error: any) {
          console.error('Error deleting thread:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'showInputBox') {
        try {
          const input = await vscode.window.showInputBox({
            prompt: msg.prompt,
            value: msg.value || '',
            placeHolder: 'Enter text...'
          });
          
          if (input !== undefined) {
            if (msg.callbackType === 'renameThread') {
              await this.openAI.setThreadName(msg.threadId, input);
              postThreads();
            }
          }
        } catch (error: any) {
          console.error('Error in input box:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'showConfirmDialog') {
        try {
          const result = await vscode.window.showWarningMessage(
            msg.message,
            { modal: true },
            'Delete'
          );
          
          if (result === 'Delete' && msg.callbackType === 'deleteThread') {
            await this.openAI.deleteThread(msg.threadId);
            postThreads();
            // If we deleted the current thread, create a new one
            const threads = await this.openAI.getThreads();
            if (threads.length === 0) {
              await this.openAI.newThread();
              postThreads();
            }
          }
        } catch (error: any) {
          console.error('Error in confirm dialog:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      } else if (msg.type === 'handlePermissionResponse') {
        if (this.permissionService) {
          this.permissionService.handlePermissionResponse(msg.id, msg.response, msg.remember);
          const stats = this.permissionService.getPermissionStats();
          webviewView.webview.postMessage({ type: 'permissionStats', stats });
        }
      } else if (msg.type === 'cancelRequest') {
        console.log('Received cancelRequest from webview');
        if (this.isProcessing) {
          try {
            await this.openAI.cancelCurrentRun();
            webviewView.webview.postMessage({ type: 'thinking', content: 'Request cancelled' });
            setTimeout(() => {
              webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: 'Request was cancelled.' });
            }, 500);
            this.isProcessing = false;
          } catch (error) {
            console.warn('Failed to cancel run:', error);
            webviewView.webview.postMessage({ type: 'error', message: 'Failed to cancel request' });
          }
        }
      } else if (msg.type === 'stopCommand') {
        if (this.permissionService) {
          this.permissionService.stopCommand();
        }
      } else if (msg.type === 'pasteImage') {
        try {
          // Handle image data (frontend уже показал файл в чате)
          const imageData = Buffer.from(msg.imageData, 'base64');
          const imageId = await this.openAI.addImage(imageData, msg.description || 'Uploaded image');
          // Не отправляем дублирующее сообщение - frontend уже показал файл
          // Отправляем сигнал завершения обработки
          webviewView.webview.postMessage({ type: 'imageUploaded', description: msg.description });
        } catch (error: any) {
          console.error('Error processing image:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error processing image: ${error.message}` });
        }
      } else if (msg.type === 'uploadAudio') {
        try {
          // Handle audio file upload (без автоматической транскрипции)
          const audioData = Buffer.from(msg.audioData, 'base64');
          
          // Добавляем аудио в RAG систему для последующей транскрипции по запросу
          const audioId = await this.openAI.addAudio(audioData, msg.filename, msg.description || 'Uploaded audio file');
          
          // Не отправляем дублирующее сообщение - frontend уже показал файл
          // Отправляем сигнал завершения обработки
          webviewView.webview.postMessage({ type: 'audioUploaded', filename: msg.filename });
        } catch (error: any) {
          console.error('Error processing audio:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error processing audio: ${error.message}` });
        }
      } else if (msg.type === 'uploadFile') {
        try {
          // Handle universal file upload (PDF, text, etc.)
          const fileData = Buffer.from(msg.fileData, 'base64');
          const fileType = msg.fileType || 'application/octet-stream';
          
          // Добавляем файл в RAG систему как текстовый контекст
          const thread = await this.openAI.getThreadInfo();
          const chatMessage = {
            id: Date.now().toString(),
            content: `User uploaded file: ${msg.filename} (${fileType})`,
            chatId: thread.active || 'default',
            timestamp: new Date().toISOString(),
          };
          
          // Можно добавить обработку конкретных типов файлов
          console.log(`File uploaded: ${msg.filename}, type: ${fileType}, size: ${fileData.length} bytes`);
          
          // Не отправляем дублирующее сообщение - frontend уже показал файл
          // Отправляем сигнал завершения обработки
          webviewView.webview.postMessage({ type: 'fileUploaded', filename: msg.filename });
        } catch (error: any) {
          console.error('Error processing file:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error processing file: ${error.message}` });
        }
      } else if (msg.type === 'transcribeAudio') {
        try {
          // Handle audio transcription with progress
          const audioData = Buffer.from(msg.audioData, 'base64');
          const transcription = await this.openAI.transcribeAudio(
            audioData, 
            msg.filename, 
            msg.language,
            (progress: number) => {
              // Send progress updates to webview
              webviewView.webview.postMessage({ 
                type: 'transcriptionProgress', 
                progress: progress,
                filename: msg.filename
              });
            }
          );
          webviewView.webview.postMessage({ 
            type: 'append', 
            role: 'assistant', 
            content: `📝 Транскрипция файла "${msg.filename}":\n\n${transcription}` 
          });
        } catch (error: any) {
          console.error('Error transcribing audio:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error transcribing audio: ${error.message}` });
        }
      } else if (msg.type === 'transcribeAudioByFilename') {
        try {
          // Транскрибация аудио по имени файла из текущего чата
          const config = vscode.workspace.getConfiguration('openaiAgent');
          const transcriptionLanguage = msg.language || config.get<string>('audio.transcriptionLanguage') || undefined;
          
          const transcription = await this.openAI.transcribeAudioByFilename(
            msg.filename,
            transcriptionLanguage,
            (progress: number) => {
              webviewView.webview.postMessage({
                type: 'transcriptionProgress',
                progress: progress,
                filename: msg.filename
              });
            }
          );
          
          webviewView.webview.postMessage({
            type: 'append',
            role: 'assistant',
            content: `📝 Транскрипция файла "${msg.filename}":\n\n${transcription}`
          });
        } catch (error: any) {
          console.error('Error transcribing audio by filename:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error transcribing audio: ${error.message}` });
        }
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    // Generate a nonce to use in the HTML
    const nonce = this.getNonce();
    
    // Get path to the script file
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'panels', 'chatView.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'panels', 'chatView.css'));
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${styleUri}">
      <title>OpenAI Agent Chat</title>
    </head>
    <body>
      <div id="app">
        <div id="header">
          <div id="thread-selector">
            <select id="thread-select"></select>
            <button id="new-thread" title="New Thread">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button id="rename-thread" title="Rename Thread">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
            <button id="delete-thread" title="Delete Thread">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3,6 5,6 21,6"></polyline>
                <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
          <div id="permission-stats">
            <span id="allowed-count">0 allowed</span>, <span id="denied-count">0 denied</span>
          </div>
        </div>
        <div id="messages"></div>
        <div id="transcription-progress" style="display: none;">
          <div id="transcription-progress-content">
            <div id="transcription-progress-icon">🎤</div>
            <div id="transcription-progress-text">Processing audio with Whisper AI...</div>
            <div id="transcription-progress-filename"></div>
            <div id="transcription-progress-bar">
              <div id="transcription-progress-fill"></div>
            </div>
            <div id="transcription-progress-percent">0%</div>
          </div>
        </div>
        <div id="terminal-container" style="display: none;">
          <div id="terminal-header">
            <span id="terminal-title">Terminal Output</span>
            <button id="terminal-close">×</button>
          </div>
          <iframe id="terminal-frame" sandbox="allow-scripts" style="width: 100%; height: 200px; border: none;"></iframe>
        </div>
        <form id="form">
          <div id="input-container">
            <textarea id="prompt" placeholder="Ask a question..." rows="1"></textarea>
            <button type="button" id="upload-image" title="Upload Image">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </button>
            <button type="button" id="upload-audio" title="Upload Audio (MP3, MP4, M4A)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
              </svg>
            </button>
            <input type="file" id="image-file-input" accept="image/*" style="display: none;">
            <input type="file" id="audio-file-input" accept=".mp3,.mp4,.m4a" style="display: none;">
          </div>
          <button type="submit">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
            </svg>
            Send
          </button>
        </form>
      </div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }
  
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
