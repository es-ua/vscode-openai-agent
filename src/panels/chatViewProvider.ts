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
        if (this.isProcessing) {
          webviewView.webview.postMessage({ type: 'error', message: 'Already processing a request, please wait...' });
          return;
        }
        
        this.isProcessing = true;
        webviewView.webview.postMessage({ type: 'thinking', content: 'Thinking...' });
        
        try {
          const response = await this.openAI.chat(msg.prompt, (step) => {
            webviewView.webview.postMessage({ type: 'updateThinking', content: step });
          });
          console.log('Chat response received');
        } catch (error: any) {
          console.error('Error in chat:', error);
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        } finally {
          this.isProcessing = false;
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
          // Handle image data from clipboard
          const imageData = Buffer.from(msg.imageData, 'base64');
          const imageId = await this.openAI.addImage(imageData, msg.description || 'Pasted image');
          webviewView.webview.postMessage({ type: 'append', role: 'user', content: `[Image: ${msg.description || 'Pasted image'}]` });
        } catch (error: any) {
          console.error('Error processing image:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error processing image: ${error.message}` });
        }
      } else if (msg.type === 'uploadAudio') {
        try {
          // Handle audio file upload
          const audioData = Buffer.from(msg.audioData, 'base64');
          const audioId = await this.openAI.addAudio(audioData, msg.filename, msg.description || 'Uploaded audio file');
          webviewView.webview.postMessage({ type: 'append', role: 'user', content: `[Audio: ${msg.filename || 'Uploaded audio file'}]` });
        } catch (error: any) {
          console.error('Error processing audio:', error);
          webviewView.webview.postMessage({ type: 'error', message: `Error processing audio: ${error.message}` });
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
          </div>
          <div id="permission-stats">
            <span id="allowed-count">0 allowed</span>, <span id="denied-count">0 denied</span>
          </div>
        </div>
        <div id="messages"></div>
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
            <button type="button" id="paste-image" title="Paste Image">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </button>
            <button type="button" id="upload-audio" title="Upload Audio (MP3, MP4)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
              </svg>
            </button>
            <input type="file" id="audio-file-input" accept=".mp3,.mp4" style="display: none;">
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
