import * as vscode from 'vscode';
import { OpenAIService } from '../services/openAIService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'openaiAgent.chatView';
  private _view?: vscode.WebviewView;
  private openAI: OpenAIService;
  private extensionUri: vscode.Uri;
  private isProcessing: boolean = false;

  constructor(openAI: OpenAIService, extensionUri: vscode.Uri) {
    this.openAI = openAI;
    this.extensionUri = extensionUri;
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
      if (webviewView.visible) postThreads();
    });

    webviewView.webview.onDidReceiveMessage(async msg => {
      if (!msg || !msg.type) return;
      if (msg.type === 'sendPrompt') {
        const prompt: string = msg.prompt || '';
        if (!prompt.trim()) return;
        
        this.isProcessing = true;
        try {
          const res = await this.openAI.chat(prompt);
          if (this.isProcessing) { // Check if not stopped
            webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: res || '(no content)' });
            
            // Auto-generate thread name from first message if thread is new
            const info = this.openAI.getThreadInfo();
            if (info.active && !info.threadNames[info.active]) {
              const threadName = prompt.length > 20 ? prompt.substring(0, 20) + '...' : prompt;
              await this.openAI.setThreadName(info.active, threadName);
              await postThreads();
            }
          }
        } catch (e: any) {
          if (this.isProcessing) { // Check if not stopped
            webviewView.webview.postMessage({ type: 'error', message: e?.message || String(e) });
          }
        } finally {
          this.isProcessing = false;
        }
      } else if (msg.type === 'newThread') {
        await this.openAI.newThread();
        try { await this.openAI.initialize(); } catch {}
        await postThreads();
        // ask webview to clear UI for fresh chat
        webviewView.webview.postMessage({ type: 'clear' });
      } else if (msg.type === 'closeThread') {
        const threadId = msg.id;
        if (threadId) {
          await this.openAI.closeThread(threadId);
          try { await this.openAI.initialize(); } catch {}
          await postThreads();
          webviewView.webview.postMessage({ type: 'clear' });
        }
      } else if (msg.type === 'switchThread') {
        await this.openAI.setActiveThread(msg.id);
        try { await this.openAI.initialize(); } catch {}
        await postThreads();
        webviewView.webview.postMessage({ type: 'clear' });
      } else if (msg.type === 'setThreadName') {
        await this.openAI.setThreadName(msg.id, msg.name);
        await postThreads();
      } else if (msg.type === 'stopAI') {
        this.isProcessing = false;
        // Note: We can't actually cancel the OpenAI API request, but we stop processing the response
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const addIcon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'add_thread.svg')).toString();
    const clearIcon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'clear_thread.svg')).toString();
    const deleteIcon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'delete_thread.svg')).toString();
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
  .tab-actions { display:flex; gap:2px; }
  .tab-btn { background:transparent; border:none; padding:1px 2px; cursor:pointer; border-radius:2px; }
  .tab-btn:hover { background:var(--vscode-editorWidget-background); }
  .tab-btn img { width:12px; height:12px; }
  #messages { flex: 1; overflow: auto; padding: 8px; }
  .msg { padding: 6px 8px; margin: 6px 0; border-radius: 6px; white-space: pre-wrap; }
  .user { background: var(--vscode-editor-selectionBackground); }
  .assistant { background: var(--vscode-editorHoverWidget-background); }
  .loading { display: flex; align-items: center; justify-content: center; padding: 20px; color: var(--vscode-foreground); opacity: 0.7; }
  .loading-spinner { width: 20px; height: 20px; border: 2px solid var(--vscode-panel-border); border-top: 2px solid var(--vscode-foreground); border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .loading-text { font-size: 12px; }
  .loading-stop { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border); border-radius: 4px; padding: 4px 8px; margin-left: 12px; cursor: pointer; font-size: 11px; }
  .loading-stop:hover { background: var(--vscode-button-hoverBackground); }
  #form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #prompt { flex: 1; }
  #prompt:disabled { opacity: 0.5; cursor: not-allowed; }
  #form button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="new" class="icon-btn" title="New"><img src="${addIcon}" alt="+"/></button>
    <div id="tabs"></div>
  </div>
  <div id="messages"></div>
  <form id="form">
    <input id="prompt" type="text" placeholder="Ask the OpenAI Agent..." />
    <button type="submit">Send</button>
  </form>
  <script nonce="abc123">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const form = document.getElementById('form');
    const prompt = document.getElementById('prompt');
    const btnNew = document.getElementById('new');
    const tabs = document.getElementById('tabs');
    const clearIcon = '${clearIcon}';
    const deleteIcon = '${deleteIcon}';

    let state = vscode.getState() || {}; if (!state.histories) state.histories = {}; if (typeof state.active === 'undefined') state.active = null;

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
      hideLoading();
      vscode.postMessage({ type: 'stopAI' });
      append('assistant', 'Operation stopped by user', true);
    }

    function setFormEnabled(enabled) {
      const prompt = document.getElementById('prompt');
      const submitBtn = document.querySelector('#form button[type="submit"]');
      if (prompt) {
        prompt.disabled = !enabled;
        prompt.placeholder = enabled ? 'Ask the OpenAI Agent...' : 'AI is thinking, please wait...';
      }
      if (submitBtn) submitBtn.disabled = !enabled;
    }

    // Make stopAI globally available
    window.stopAI = stopAI;

    function renderHistory(){
      clearUI();
      const hist = (state.active && state.histories[state.active]) ? state.histories[state.active] : [];
      hist.forEach(m => append(m.role, m.content, false));
    }

    function append(role, content, save=true) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      el.textContent = (role === 'assistant' ? 'AI: ' : 'You: ') + content;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      if (save && state.active){
        (state.histories[state.active] = state.histories[state.active] || []).push({ role, content });
        vscode.setState(state);
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'append') {
        hideLoading();
        append(msg.role, msg.content, true);
      } else if (msg.type === 'error') {
        hideLoading();
        append('assistant', 'Error: ' + msg.message, true);
      } else if (msg.type === 'threads') {
        const ids = (msg.info && msg.info.threads) || [];
        const active = (msg.info && msg.info.active) || null;
        if (!active || !ids.includes(active)) { state.active = ids.length ? ids[ids.length-1] : null; vscode.setState(state); }
        renderTabs(msg.info);
        // Show existing history immediately if available, otherwise show loading
        if (state.active && state.histories[state.active]) {
          renderHistory();
        } else if (state.active) {
          showLoading('Loading chat history...', true);
        }
      } else if (msg.type === 'loadHistory') {
        // Load history from server and update local state
        hideLoading();
        if (state.active && msg.history) {
          state.histories[state.active] = msg.history;
          vscode.setState(state);
          renderHistory();
        }
      } else if (msg.type === 'clear') {
        hideLoading();
        clearUI();
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = prompt.value || '';
      if (!value.trim()) return;
      
      // If already processing, stop current operation and start new one
      if (document.querySelector('.loading')) {
        stopAI();
        // Small delay to ensure stop is processed
        setTimeout(() => {
          prompt.value = '';
          append('user', value);
          showLoading('AI is thinking...', true, true);
          vscode.postMessage({ type: 'sendPrompt', prompt: value });
        }, 100);
      } else {
        prompt.value = '';
        append('user', value);
        showLoading('AI is thinking...', true, true);
        vscode.postMessage({ type: 'sendPrompt', prompt: value });
      }
    });

    btnNew.addEventListener('click', () => {
      showLoading('Creating new thread...');
      vscode.postMessage({ type:'newThread' });
    });
  </script>
</body>
</html>`;
  }
}
