import * as vscode from 'vscode';
import { OpenAIService } from '../services/openAIService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'openaiAgent.chatView';
  private _view?: vscode.WebviewView;
  private openAI: OpenAIService;
  private extensionUri: vscode.Uri;

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

    const postThreads = () => {
      const info = this.openAI.getThreadInfo();
      webviewView.webview.postMessage({ type: 'threads', info });
    };

    try { await this.openAI.initialize(); } catch {}
    postThreads();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) postThreads();
    });

    webviewView.webview.onDidReceiveMessage(async msg => {
      if (!msg || !msg.type) return;
      if (msg.type === 'sendPrompt') {
        const prompt: string = msg.prompt || '';
        if (!prompt.trim()) return;
        try {
          const res = await this.openAI.chat(prompt);
          webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: res || '(no content)' });
        } catch (e: any) {
          webviewView.webview.postMessage({ type: 'error', message: e?.message || String(e) });
        }
      } else if (msg.type === 'newThread') {
        await this.openAI.newThread();
        try { await this.openAI.initialize(); } catch {}
    postThreads();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) postThreads();
    });
        // ask webview to clear UI for fresh chat
        webviewView.webview.postMessage({ type: 'clear' });
      } else if (msg.type === 'closeThread') {
        const info = this.openAI.getThreadInfo();
        if (info.active) {
          await this.openAI.closeThread(info.active);
          try { await this.openAI.initialize(); } catch {}
    postThreads();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) postThreads();
    });
          webviewView.webview.postMessage({ type: 'clear' });
        }
      } else if (msg.type === 'switchThread') {
        await this.openAI.setActiveThread(msg.id);
        try { await this.openAI.initialize(); } catch {}
    postThreads();

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) postThreads();
    });
        webviewView.webview.postMessage({ type: 'clear' });
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
  .tab { padding:2px 6px; border-radius:4px; border:1px solid var(--vscode-panel-border); cursor:pointer; }
  .tab.active { background: var(--vscode-editorWidget-background); border-color: var(--vscode-editorWidget-border); }
  #messages { flex: 1; overflow: auto; padding: 8px; }
  .msg { padding: 6px 8px; margin: 6px 0; border-radius: 6px; white-space: pre-wrap; }
  .user { background: var(--vscode-editor-selectionBackground); }
  .assistant { background: var(--vscode-editorHoverWidget-background); }
  #form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #prompt { flex: 1; }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="new" class="icon-btn" title="New"><img src="${addIcon}" alt="+"/></button>
    <button id="clear" class="icon-btn" title="Clear"><img src="${clearIcon}" alt="x"/></button>
    <button id="close" class="icon-btn" title="Close"><img src="${deleteIcon}" alt="-"/></button>
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
    const btnClear = document.getElementById('clear');
    const btnClose = document.getElementById('close');
    const tabs = document.getElementById('tabs');

    let state = vscode.getState() || {}; if (!state.histories) state.histories = {}; if (typeof state.active === 'undefined') state.active = null;

    function setActive(id){ state.active = id; vscode.setState(state); renderHistory(); }

    function renderTabs(info){
      tabs.innerHTML='';
      (info.threads||[]).forEach(id => {
        const el = document.createElement('div');
        el.className = 'tab' + (id === info.active ? ' active' : '');
        el.textContent = id.slice(0,6);
        el.onclick = () => { state.active = id; vscode.setState(state); renderHistory(); vscode.postMessage({ type:'switchThread', id }); };
        tabs.appendChild(el);
      });
      setActive(info.active || null);
    }

    function clearUI(){ messages.innerHTML=''; }

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
        append(msg.role, msg.content, true);
      } else if (msg.type === 'error') {
        append('assistant', 'Error: ' + msg.message, true);
      } else if (msg.type === 'threads') {
        const ids = (msg.info && msg.info.threads) || [];
        const active = (msg.info && msg.info.active) || null;
        if (!active || !ids.includes(active)) { state.active = ids.length ? ids[ids.length-1] : null; vscode.setState(state); }
        renderTabs(msg.info);
      } else if (msg.type === 'clear') {
        clearUI();
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = prompt.value || '';
      if (!value.trim()) return;
      prompt.value = '';
      append('user', value);
      vscode.postMessage({ type: 'sendPrompt', prompt: value });
    });

    btnNew.addEventListener('click', () => vscode.postMessage({ type:'newThread' }));
    btnClear.addEventListener('click', () => { if (state.active){ state.histories[state.active] = []; vscode.setState(state); clearUI(); } });
    btnClose.addEventListener('click', () => vscode.postMessage({ type:'closeThread' }));
  </script>
</body>
</html>`;
  }
}
