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

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async msg => {
      if (msg && msg.type === 'sendPrompt') {
        const prompt: string = msg.prompt || '';
        if (!prompt.trim()) return;
        webviewView.webview.postMessage({ type: 'append', role: 'user', content: prompt });
        try {
          const res = await this.openAI.chat(prompt);
          webviewView.webview.postMessage({ type: 'append', role: 'assistant', content: res || '(no content)' });
        } catch (e: any) {
          webviewView.webview.postMessage({ type: 'error', message: e?.message || String(e) });
        }
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-abc123' ${webview.cspSource};`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; display: flex; flex-direction: column; height: 100vh; }
  #messages { flex: 1; overflow: auto; padding: 8px; }
  .msg { padding: 6px 8px; margin: 6px 0; border-radius: 6px; white-space: pre-wrap; }
  .user { background: var(--vscode-editor-selectionBackground); }
  .assistant { background: var(--vscode-editorHoverWidget-background); }
  #form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #prompt { flex: 1; }
</style>
</head>
<body>
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

    function append(role, content) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      el.textContent = (role === 'assistant' ? 'AI: ' : 'You: ') + content;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'append') {
        append(msg.role, msg.content);
      } else if (msg.type === 'error') {
        append('assistant', 'Error: ' + msg.message);
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = prompt.value || '';
      prompt.value = '';
      vscode.postMessage({ type: 'sendPrompt', prompt: value });
    });
  </script>
</body>
</html>`;
  }
}
