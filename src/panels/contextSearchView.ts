import * as vscode from 'vscode';
import { OpenAIServiceInterface } from '../services/openAIServiceInterface';

export class ContextSearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'openaiAgent.contextSearchView';
  private _view?: vscode.WebviewView;
  private openAI: OpenAIServiceInterface;
  private extensionUri: vscode.Uri;

  constructor(openAI: OpenAIServiceInterface, extensionUri: vscode.Uri) {
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
    
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'search') {
        const query = msg.query;
        if (!query) {
          webviewView.webview.postMessage({ type: 'searchResults', results: [] });
          return;
        }
        
        try {
          const results = await this.openAI.searchContext(query);
          webviewView.webview.postMessage({ type: 'searchResults', results });
        } catch (error) {
          console.error('Error searching context:', error);
          webviewView.webview.postMessage({ 
            type: 'error', 
            message: `Error searching context: ${error instanceof Error ? error.message : String(error)}` 
          });
        }
      } else if (msg.type === 'openFile') {
        try {
          const { path, startLine } = msg;
          const uri = vscode.Uri.file(path);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);
          
          if (startLine !== undefined) {
            const line = Math.max(0, startLine - 1); // Convert to 0-indexed
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );
          }
        } catch (error) {
          console.error('Error opening file:', error);
          webviewView.webview.postMessage({ 
            type: 'error', 
            message: `Error opening file: ${error instanceof Error ? error.message : String(error)}` 
          });
        }
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Context Search</title>
      <style>
        body {
          padding: 10px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
        }
        .search-container {
          margin-bottom: 15px;
        }
        .search-box {
          width: 100%;
          padding: 5px;
          margin-bottom: 10px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        .search-button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 5px 10px;
          cursor: pointer;
        }
        .search-button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        .result {
          margin-bottom: 15px;
          padding: 10px;
          background-color: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
        }
        .result-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 5px;
        }
        .result-type {
          font-weight: bold;
          color: var(--vscode-symbolIcon-classForeground);
        }
        .result-score {
          color: var(--vscode-descriptionForeground);
          font-size: 0.9em;
        }
        .result-path {
          font-family: var(--vscode-editor-font-family);
          font-size: 0.9em;
          color: var(--vscode-textLink-foreground);
          cursor: pointer;
          margin-bottom: 5px;
        }
        .result-path:hover {
          text-decoration: underline;
        }
        .result-content {
          font-family: var(--vscode-editor-font-family);
          font-size: 0.9em;
          white-space: pre-wrap;
          overflow-x: auto;
          padding: 5px;
          background-color: var(--vscode-textCodeBlock-background);
          border-radius: 3px;
        }
        .error-message {
          color: var(--vscode-errorForeground);
          margin: 10px 0;
        }
        .no-results {
          color: var(--vscode-descriptionForeground);
          margin: 10px 0;
        }
      </style>
    </head>
    <body>
      <div class="search-container">
        <input type="text" class="search-box" placeholder="Search code context..." id="search-box">
        <button class="search-button" id="search-button">Search</button>
      </div>
      
      <div id="error-container" style="display: none;"></div>
      <div id="results-container"></div>
      
      <script nonce="${nonce}">
        (function() {
          const vscode = acquireVsCodeApi();
          const searchBox = document.getElementById('search-box');
          const searchButton = document.getElementById('search-button');
          const errorContainer = document.getElementById('error-container');
          const resultsContainer = document.getElementById('results-container');
          
          // Handle search button click
          searchButton.addEventListener('click', () => {
            performSearch();
          });
          
          // Handle Enter key in search box
          searchBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              performSearch();
            }
          });
          
          function performSearch() {
            const query = searchBox.value.trim();
            if (!query) {
              showError('Please enter a search query');
              return;
            }
            
            // Clear previous results and errors
            resultsContainer.innerHTML = '<div style="text-align: center; margin-top: 20px;">Searching...</div>';
            errorContainer.style.display = 'none';
            
            // Send search request to extension
            vscode.postMessage({ type: 'search', query });
          }
          
          function showError(message) {
            errorContainer.innerHTML = \`<div class="error-message">\${message}</div>\`;
            errorContainer.style.display = 'block';
            resultsContainer.innerHTML = '';
          }
          
          function renderResults(results) {
            resultsContainer.innerHTML = '';
            
            if (results.length === 0) {
              resultsContainer.innerHTML = '<div class="no-results">No results found. Try a different search query.</div>';
              return;
            }
            
            results.forEach(result => {
              const resultEl = document.createElement('div');
              resultEl.className = 'result';
              
              const headerEl = document.createElement('div');
              headerEl.className = 'result-header';
              
              const typeEl = document.createElement('div');
              typeEl.className = 'result-type';
              typeEl.textContent = result.metadata.type.charAt(0).toUpperCase() + result.metadata.type.slice(1);
              headerEl.appendChild(typeEl);
              
              const scoreEl = document.createElement('div');
              scoreEl.className = 'result-score';
              scoreEl.textContent = \`Score: \${Math.round(result.score * 100) / 100}\`;
              headerEl.appendChild(scoreEl);
              
              resultEl.appendChild(headerEl);
              
              if (result.metadata.path) {
                const pathEl = document.createElement('div');
                pathEl.className = 'result-path';
                const lineInfo = result.metadata.startLine ? \` (Line \${result.metadata.startLine})\` : '';
                pathEl.textContent = \`\${result.metadata.path}\${lineInfo}\`;
                pathEl.addEventListener('click', () => {
                  vscode.postMessage({ 
                    type: 'openFile', 
                    path: result.metadata.path, 
                    startLine: result.metadata.startLine
                  });
                });
                resultEl.appendChild(pathEl);
              }
              
              const contentEl = document.createElement('div');
              contentEl.className = 'result-content';
              contentEl.textContent = result.text;
              resultEl.appendChild(contentEl);
              
              resultsContainer.appendChild(resultEl);
            });
          }
          
          // Listen for messages from the extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
              case 'searchResults':
                renderResults(message.results);
                break;
              case 'error':
                showError(message.message);
                break;
            }
          });
        })();
      </script>
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
