import * as vscode from 'vscode';
import { OpenAIService } from '../services/openAIService';
import { ConfigurationService } from '../services/configurationService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'openaiAgent.chatView';
  public static readonly panelViewId = 'openaiAgent.panelView';
  private _view?: vscode.WebviewView;
  private openAI: OpenAIService;
  private configService: ConfigurationService;
  private extensionUri: vscode.Uri;
  private isProcessing: boolean = false;

  constructor(openAI: OpenAIService, configService: ConfigurationService, extensionUri: vscode.Uri) {
    this.openAI = openAI;
    this.configService = configService;
    this.extensionUri = extensionUri;
  }

  private sendMessage(type: string, data: any) {
    if (this._view) {
      this._view.webview.postMessage({ type, ...data });
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    const postThreads = async () => {
      const info = this.openAI.getThreadInfo();
      webviewView.webview.postMessage({ type: 'threads', info });
      
      // Load history for active thread with a small delay to avoid conflicts
      if (info.active) {
        const activeThreadId = info.active;
        setTimeout(async () => {
          try {
            const history = await this.openAI.getThreadHistory(activeThreadId);
            webviewView.webview.postMessage({ type: 'loadHistory', history });
          } catch (error: any) {
            console.error('Failed to load thread history:', error);
            webviewView.webview.postMessage({ type: 'error', message: 'Failed to load chat history' });
          }
        }, 100);
      }
    };

    try { await this.openAI.initialize(); } catch {}
    await postThreads();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        postThreads();
      }
    });

    webviewView.webview.onDidReceiveMessage(async msg => {
      if (!msg || !msg.type) return;
      if (msg.type === 'sendPrompt') {
        const prompt: string = msg.prompt || '';
        if (!prompt.trim()) return;
        
        // Cancel any current run before starting a new one
        if (this.isProcessing) {
          try {
            await this.openAI.cancelCurrentRun();
          } catch (error) {
            console.warn('Failed to cancel previous run:', error);
          }
        }
        
        this.isProcessing = true;
        try {
          // Show initial thinking
          webviewView.webview.postMessage({ type: 'thinking', content: 'Analyzing your question...' });
          
          const res = await this.openAI.chat(prompt, (thinkingStep: string) => {
            if (this.isProcessing) {
              webviewView.webview.postMessage({ type: 'updateThinking', content: thinkingStep });
            }
          });
          
          // Always send the response, regardless of isProcessing state
          webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: res || '(no content)' });
          
          // Auto-generate thread name from first message if thread is new
          const info = this.openAI.getThreadInfo();
          if (info.active && !info.threadNames[info.active]) {
            const threadName = prompt.length > 20 ? prompt.substring(0, 20) + '...' : prompt;
            await this.openAI.setThreadName(info.active, threadName);
            await postThreads();
          }
        } catch (e: any) {
          // Always send error, regardless of isProcessing state
          webviewView.webview.postMessage({ type: 'error', message: e?.message || String(e) });
        } finally {
          this.isProcessing = false;
        }
      } else if (msg.type === 'newThread') {
        // If currently processing, stop the current process first
        if (this.isProcessing) {
          this.isProcessing = false;
          webviewView.webview.postMessage({ type: 'thinking', content: 'Creating new thread...' });
        }
        await this.openAI.newThread();
        try { await this.openAI.initialize(); } catch {}
        await postThreads();
        // ask webview to clear UI for fresh chat
        webviewView.webview.postMessage({ type: 'clear' });
      } else if (msg.type === 'closeThread') {
        const threadId = msg.id;
        const activeThreadId = this.openAI.getActiveThreadId();
        
        // If closing the active thread and currently processing, stop the current process first
        if (this.isProcessing && threadId === activeThreadId) {
          this.isProcessing = false;
          webviewView.webview.postMessage({ type: 'thinking', content: 'Stopping AI and closing thread...' });
        }
        
        if (threadId) {
          await this.openAI.closeThread(threadId);
          try { await this.openAI.initialize(); } catch {}
          await postThreads();
          webviewView.webview.postMessage({ type: 'clear' });
        }
      } else if (msg.type === 'switchThread') {
        // If currently processing, stop the current process first
        if (this.isProcessing) {
          this.isProcessing = false;
          webviewView.webview.postMessage({ type: 'thinking', content: 'Switching threads...' });
        }
        await this.openAI.setActiveThread(msg.id);
        try { await this.openAI.initialize(); } catch {}
        await postThreads();
        webviewView.webview.postMessage({ type: 'clear' });
      } else if (msg.type === 'setThreadName') {
        await this.openAI.setThreadName(msg.id, msg.name);
        await postThreads();
      } else if (msg.type === 'stopAI') {
        this.isProcessing = false;
        // Cancel the current OpenAI run
        try {
          await this.openAI.cancelCurrentRun();
        } catch (error) {
          console.warn('Failed to cancel OpenAI run:', error);
        }
      } else if (msg.type === 'setMode') {
        // Call the setMode command
        vscode.commands.executeCommand('vscode-openai-agent.setMode', msg.mode);
        // Send mode change confirmation to the webview
        webviewView.webview.postMessage({ type: 'modeChanged', mode: msg.mode });
      } else if (msg.type === 'setModel') {
        // Update the model setting
        await this.configService.setModel(msg.model);
        webviewView.webview.postMessage({ type: 'modelChanged', model: msg.model });
      } else if (msg.type === 'getCurrentModel') {
        // Send current model to webview
        const currentModel = this.configService.getModel();
        webviewView.webview.postMessage({ type: 'modelChanged', model: currentModel });
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const addIcon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'add_macos.svg')).toString();
    const clearIcon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'clear_macos.svg')).toString();
    const deleteIcon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'close_macos.svg')).toString();
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-abc123' ${webview.cspSource};`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; display: flex; flex-direction: column; height: 100vh; }
  #toolbar { display:flex; gap:6px; align-items:center; padding:6px; border-bottom: 1px solid var(--vscode-panel-border); }
  .icon-btn { background: transparent; border: 1px solid var(--vscode-panel-border); border-radius:4px; padding:2px 6px; cursor:pointer; }
  .icon-btn:hover { background: var(--vscode-editorWidget-background); }
  .icon-btn img { width:16px; height:16px; display:block; }
  #tabs { margin-left:auto; font-size:11px; opacity:.85; display:flex; gap:6px; flex-wrap:wrap; }
  .tab { padding:2px 6px; border-radius:4px; border:1px solid var(--vscode-panel-border); cursor:pointer; display:flex; align-items:center; gap:4px; }
  .tab.active { background: var(--vscode-editorWidget-background); border-color: var(--vscode-editorWidget-border); }
  .tab-actions { display:flex; gap:4px; align-items:center; }
  .tab-btn { 
    background:transparent; 
    border:none; 
    padding:2px; 
    cursor:pointer; 
    border-radius:50%; 
    width:16px; 
    height:16px; 
    display:flex; 
    align-items:center; 
    justify-content:center;
    transition: all 0.2s ease;
  }
  .tab-btn:hover { 
    background:rgba(0,0,0,0.1); 
    transform: scale(1.1);
  }
  .tab-btn img { 
    width:12px; 
    height:12px; 
    pointer-events: none;
  }
  #messages { flex: 1; overflow: auto; padding: 8px; }
  .msg { padding: 6px 8px; margin: 6px 0; border-radius: 6px; white-space: pre-wrap; }
  .user { background: var(--vscode-editor-selectionBackground); }
  .assistant { background: var(--vscode-editorHoverWidget-background); }
  .msg-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .msg-role {
    font-weight: 600;
    color: var(--vscode-textLink-foreground);
    font-size: 0.9em;
  }
  .msg-text {
    line-height: 1.5;
  }
  .msg-text strong {
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .msg-text em {
    font-style: italic;
    color: var(--vscode-descriptionForeground);
  }
  .msg-text code {
    background: var(--vscode-textCodeBlock-background);
    color: var(--vscode-textPreformat-foreground);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
  }
  .msg-text pre {
    background: var(--vscode-textCodeBlock-background);
    color: var(--vscode-textPreformat-foreground);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
    border: 1px solid var(--vscode-panel-border);
  }
  .msg-text pre code {
    background: none;
    padding: 0;
    border-radius: 0;
  }
  .msg-text h1, .msg-text h2, .msg-text h3 {
    margin: 12px 0 8px 0;
    color: var(--vscode-foreground);
  }
  .msg-text h1 { font-size: 1.3em; }
  .msg-text h2 { font-size: 1.2em; }
  .msg-text h3 { font-size: 1.1em; }
  .msg-text hr {
    border: none;
    border-top: 1px solid var(--vscode-panel-border);
    margin: 12px 0;
  }
  .thinking { 
    background: var(--vscode-editorWidget-background); 
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    margin: 6px 0;
    padding: 12px;
    font-style: italic;
    opacity: 0.8;
    position: relative;
  }
  .thinking-header {
    font-weight: 600;
    color: var(--vscode-foreground);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .thinking-content {
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
    line-height: 1.4;
  }
  .thinking-icon {
    width: 16px;
    height: 16px;
    opacity: 0.7;
  }
  .loading { display: flex; align-items: center; justify-content: center; padding: 20px; color: var(--vscode-foreground); opacity: 0.7; }
  .loading-spinner { width: 20px; height: 20px; border: 2px solid var(--vscode-panel-border); border-top: 2px solid var(--vscode-foreground); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .loading-text { font-size: 12px; }
  .loading-stop { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border); border-radius: 4px; padding: 4px 8px; margin-left: 12px; cursor: pointer; font-size: 11px; }
  .loading-stop:hover { background: var(--vscode-button-hoverBackground); }
  #form { 
    display: flex; 
    gap: 8px; 
    padding: 12px 16px; 
    border-top: 1px solid var(--vscode-panel-border); 
    background: var(--vscode-editor-background);
    align-items: center;
    transition: all 0.3s ease;
  }
  #form.loading {
    background: var(--vscode-editorWidget-background);
    box-shadow: 0 -2px 8px rgba(0,0,0,0.1);
  }
  #prompt { 
    flex: 1; 
    padding: 8px 16px;
    border: 1px solid var(--vscode-input-border);
    border-radius: 20px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 14px;
    outline: none;
    transition: all 0.2s ease;
    position: relative;
    resize: none;
    min-height: 18px;
    max-height: 36px;
    font-family: inherit;
    line-height: 1.4;
  }
  #prompt::placeholder {
    color: var(--vscode-input-placeholderForeground);
    transition: opacity 0.2s ease;
  }
  #prompt:focus::placeholder {
    opacity: 0.7;
  }
  #prompt:focus { 
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder), 0 2px 8px rgba(0,0,0,0.1);
    transform: translateY(-1px);
  }
  #prompt:disabled { 
    opacity: 0.6; 
    cursor: not-allowed; 
    background: var(--vscode-input-background);
  }
  #form button { 
    padding: 10px 20px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 20px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    min-width: 80px;
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
  }
  #form button:hover:not(:disabled) { 
    background: var(--vscode-button-hoverBackground);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  #form button:active:not(:disabled) { 
    transform: translateY(0) scale(0.98);
  }
  #form button:disabled { 
    opacity: 0.5; 
    cursor: not-allowed; 
    transform: none;
    box-shadow: none;
  }
  #form button svg {
    transition: transform 0.2s ease;
  }
  #form button:hover:not(:disabled) svg {
    transform: translateX(2px);
  }
  #mode-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-panel-border);
    font-size: 12px;
    color: var(--vscode-foreground);
  }
  #mode-selector label {
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
  }
  #mode-select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    outline: none;
    transition: all 0.2s ease;
  }
  #mode-select:focus {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }
  #mode-select:hover {
    border-color: var(--vscode-input-border);
  }
  #model-select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    outline: none;
    transition: all 0.2s ease;
  }
  #model-select:focus {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }
  #model-select:hover {
    border-color: var(--vscode-input-border);
  }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="new" class="icon-btn" title="New"><img src="${addIcon}" alt="+"/></button>
    <div id="tabs"></div>
  </div>
  <div id="messages"></div>
  <form id="form">
    <textarea id="prompt" placeholder="Ask the OpenAI Agent... (Ctrl+Enter for new line, Enter to send)" rows="1"></textarea>
    <button type="submit">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
      </svg>
      Send
    </button>
  </form>
  <div id="mode-selector">
    <label for="mode-select">Mode:</label>
    <select id="mode-select">
      <option value="agent">🤖 Agent (Auto-suggestions)</option>
      <option value="ask">❓ Ask (Manual questions)</option>
    </select>
    <label for="model-select">Model:</label>
    <select id="model-select">
      <option value="gpt-4o">GPT-4o</option>
      <option value="gpt-4o-mini">GPT-4o Mini</option>
      <option value="gpt-4.1">GPT-4.1</option>
      <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
    </select>
  </div>
  <script nonce="abc123">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const form = document.getElementById('form');
    const prompt = document.getElementById('prompt');
    const btnNew = document.getElementById('new');
    const tabs = document.getElementById('tabs');
    const modeSelect = document.getElementById('mode-select');
    const modelSelect = document.getElementById('model-select');
    const clearIcon = '${clearIcon}';
    const deleteIcon = '${deleteIcon}';

    let state = vscode.getState() || {}; if (!state.histories) state.histories = {}; if (typeof state.active === 'undefined') state.active = null;

    // Initialize model selector with current value
    vscode.postMessage({ type: 'getCurrentModel' });

    function setActive(id){ state.active = id; vscode.setState(state); }

    function renderTabs(info){
      tabs.innerHTML='';
      
      if (!info || !info.threads || info.threads.length === 0) {
        return;
      }
      
      (info.threads||[]).forEach(id => {
        const el = document.createElement('div');
        el.className = 'tab' + (id === info.active ? ' active' : '');
        
        // Show thread name if available, otherwise show first 6 chars of ID
        const threadName = (info.threadNames && info.threadNames[id]) || id.slice(0,6);
        
        // Create tab content
        const tabContent = document.createElement('span');
        tabContent.textContent = threadName;
        tabContent.title = 'Thread: ' + id;
        
        // Create actions container
        const actions = document.createElement('div');
        actions.className = 'tab-actions';
        
        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'tab-btn';
        clearBtn.title = 'Clear thread';
        clearBtn.innerHTML = '<img src="' + clearIcon + '" alt="Clear"/>';
        clearBtn.onclick = function(e) { 
          e.stopPropagation(); 
          if (state.active === id) {
            state.histories[id] = []; 
            vscode.setState(state); 
            clearUI(); 
          }
        };
        
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-btn';
        closeBtn.title = 'Close thread';
        closeBtn.innerHTML = '<img src="' + deleteIcon + '" alt="Close"/>';
        closeBtn.onclick = function(e) { 
          e.stopPropagation(); 
          vscode.postMessage({ type:'closeThread', id: id }); 
        };
        
        // Add elements to tab
        actions.appendChild(clearBtn);
        actions.appendChild(closeBtn);
        el.appendChild(tabContent);
        el.appendChild(actions);
        
        // Tab click handler
        el.onclick = function() { 
          showLoading('Switching to thread...', true);
          vscode.postMessage({ type:'switchThread', id: id }); 
        };
        el.addEventListener('dblclick', function() { 
          var newName = prompt('Enter thread name:', threadName);
          if (newName && newName.trim()) {
            vscode.postMessage({ type:'setThreadName', id: id, name: newName.trim() });
          }
        });
        
        tabs.appendChild(el);
      });
      setActive(info.active || null);
    }

    function clearUI(){ messages.innerHTML=''; }

    function showLoading(text = 'Loading chat history...', showStopButton = false, blockForm = false) {
      clearUI();
      const loadingEl = document.createElement('div');
      loadingEl.className = 'loading';
      
      let stopButtonHtml = '';
      if (showStopButton) {
        stopButtonHtml = '<button class="loading-stop" onclick="stopAI()">Stop</button>';
      }
      
      loadingEl.innerHTML = '<div class="loading-spinner"></div><span class="loading-text">' + text + '</span>' + stopButtonHtml;
      messages.appendChild(loadingEl);
      
      if (blockForm) {
        setFormEnabled(false);
      }
    }

    function hideLoading() {
      const loadingEl = messages.querySelector('.loading');
      if (loadingEl) {
        loadingEl.remove();
      }
      setFormEnabled(true);
    }

    function stopAI() {
      console.log('stopAI called');
      hideLoading();
      removeThinking();
      setFormEnabled(true);
      vscode.postMessage({ type: 'stopAI' });
      append('assistant', 'Operation stopped by user', true);
    }

    function setFormEnabled(enabled) {
      console.log('setFormEnabled called with:', enabled);
      const prompt = document.getElementById('prompt');
      const submitBtn = document.querySelector('#form button');
      const form = document.getElementById('form');
      
      console.log('Found submitBtn:', submitBtn);
      
      if (prompt) {
        prompt.disabled = !enabled;
        prompt.placeholder = enabled ? 'Ask the OpenAI Agent...' : 'AI is thinking, please wait...';
      }
      if (submitBtn) {
        console.log('Current button type:', submitBtn.type);
        console.log('Current button innerHTML:', submitBtn.innerHTML);
        if (enabled) {
          console.log('Setting button to Send');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22,2 15,22 11,13 2,9 22,2"></polygon></svg>Send';
          submitBtn.onclick = null;
          submitBtn.type = 'submit';
          console.log('Button set to Send, new type:', submitBtn.type);
        } else {
          console.log('Setting button to Stop');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>Stop';
          submitBtn.onclick = function(e) { e.preventDefault(); stopAI(); };
          submitBtn.type = 'button';
          console.log('Button set to Stop, new type:', submitBtn.type);
        }
      } else {
        console.error('Submit button not found!');
      }
      if (form) {
        if (enabled) {
          form.classList.remove('loading');
        } else {
          form.classList.add('loading');
        }
      }
    }

    // Make stopAI globally available
    window.stopAI = stopAI;

    function renderHistory(history = []){
      clearUI();
      // History is passed from server, not from local state
      history.forEach(m => append(m.role, m.content, false));
    }

    function append(role, content, save=true) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      
      // Use innerHTML to support basic HTML formatting
      el.innerHTML = (role === 'assistant' ? '<strong>AI:</strong> ' : '<strong>You:</strong> ') + content;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      // Note: History is now stored on OpenAI server, not locally
      // Local state is only used for UI state and thinking process
    }

    function appendThinking(content) {
      const el = document.createElement('div');
      el.className = 'thinking';
      
      const header = document.createElement('div');
      header.className = 'thinking-header';
      header.innerHTML = '<svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>AI is thinking...';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'thinking-content';
      contentDiv.textContent = content;
      
      el.appendChild(header);
      el.appendChild(contentDiv);
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    function updateThinking(content) {
      const thinkingEl = messages.querySelector('.thinking .thinking-content');
      if (thinkingEl) {
        thinkingEl.textContent = content;
        messages.scrollTop = messages.scrollHeight;
      }
    }

    function removeThinking() {
      const thinkingEl = messages.querySelector('.thinking');
      if (thinkingEl) {
        thinkingEl.remove();
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'append') {
        console.log('Received append message, restoring form');
        console.log('Message content:', msg.content);
        hideLoading();
        removeThinking();
        console.log('About to call setFormEnabled(true)');
        setFormEnabled(true);
        append(msg.role, msg.content, true);
      } else if (msg.type === 'thinking') {
        hideLoading();
        setFormEnabled(false);
        if (msg.content) {
          appendThinking(msg.content);
        }
      } else if (msg.type === 'updateThinking') {
        if (msg.content) {
          updateThinking(msg.content);
        }
      } else if (msg.type === 'error') {
        hideLoading();
        removeThinking();
        setFormEnabled(true);
        append('assistant', 'Error: ' + msg.message, true);
      } else if (msg.type === 'threads') {
        const ids = (msg.info && msg.info.threads) || [];
        const active = (msg.info && msg.info.active) || null;
        if (!active || !ids.includes(active)) { state.active = ids.length ? ids[ids.length-1] : null; vscode.setState(state); }
        renderTabs(msg.info);
        // Always load history from server
        if (state.active) {
          showLoading('Loading chat history...', true);
        }
      } else if (msg.type === 'loadHistory') {
        // Load history from server
        hideLoading();
        if (state.active && msg.history) {
          renderHistory(msg.history);
        }
      } else if (msg.type === 'clear') {
        hideLoading();
        clearUI();
      } else if (msg.type === 'restoreForm') {
        console.log('Received restoreForm message, restoring form');
        hideLoading();
        removeThinking();
        setFormEnabled(true);
      } else if (msg.type === 'modeChanged') {
        console.log('Mode changed to:', msg.mode);
        // Update the select element to reflect the new mode
        if (modeSelect) {
          modeSelect.value = msg.mode;
        }
      } else if (msg.type === 'modelChanged') {
        console.log('Model changed to:', msg.model);
        // Update the select element to reflect the new model
        if (modelSelect) {
          modelSelect.value = msg.model;
        }
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = prompt.value || '';
      if (!value.trim()) return;
      
      // If already processing, stop current operation and start new one
      if (document.querySelector('.thinking')) {
        stopAI();
        // Small delay to ensure stop is processed
        setTimeout(() => {
          prompt.value = '';
          append('user', value);
          setFormEnabled(false);
          vscode.postMessage({ type: 'sendPrompt', prompt: value });
        }, 100);
      } else {
        prompt.value = '';
        append('user', value);
        setFormEnabled(false);
        vscode.postMessage({ type: 'sendPrompt', prompt: value });
      }
    });

    btnNew.addEventListener('click', () => {
      showLoading('Creating new thread...');
      vscode.postMessage({ type:'newThread' });
    });

    // Handle mode switching
    modeSelect.addEventListener('change', (e) => {
      const selectedMode = e.target.value;
      vscode.postMessage({ type: 'setMode', mode: selectedMode });
    });

    // Handle model switching
    modelSelect.addEventListener('change', (e) => {
      const selectedModel = e.target.value;
      vscode.postMessage({ type: 'setModel', model: selectedModel });
    });

    // Handle Enter and Ctrl+Enter for textarea
    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.ctrlKey) {
          // Ctrl+Enter: Add new line
          e.preventDefault();
          const start = prompt.selectionStart;
          const end = prompt.selectionEnd;
          const value = prompt.value;
          prompt.value = value.substring(0, start) + '\\n' + value.substring(end);
          prompt.selectionStart = prompt.selectionEnd = start + 1;
          autoResize();
        } else {
          // Enter: Send message
          e.preventDefault();
          form.dispatchEvent(new Event('submit'));
        }
      }
    });

    // Auto-resize textarea based on content
    function autoResize() {
      prompt.style.height = 'auto';
      const scrollHeight = prompt.scrollHeight;
      const maxHeight = 36; // max-height from CSS (1.5 lines)
      prompt.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    }

    // Auto-resize on input
    prompt.addEventListener('input', autoResize);

    // Initial resize
    autoResize();
  </script>
</body>
</html>`;
  }
}
