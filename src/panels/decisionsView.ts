import * as vscode from 'vscode';
import { OpenAIServiceInterface } from '../services/openAIServiceInterface';

export class DecisionsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'openaiAgent.decisionsView';
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
      if (msg.type === 'getDecisions') {
        const decisions = await this.openAI.getRelevantDecisions(msg.query || '');
        webviewView.webview.postMessage({ type: 'decisions', decisions });
      } else if (msg.type === 'addDecision') {
        await this.openAI.addDecision(msg.decision);
        const decisions = await this.openAI.getRelevantDecisions('');
        webviewView.webview.postMessage({ type: 'decisions', decisions });
      }
    });
    
    // Load initial decisions
    const decisions = await this.openAI.getRelevantDecisions('');
    webviewView.webview.postMessage({ type: 'decisions', decisions });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Project Decisions</title>
      <style>
        body {
          padding: 10px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
        }
        .decision {
          margin-bottom: 15px;
          padding: 10px;
          background-color: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
        }
        .decision-title {
          font-weight: bold;
          margin-bottom: 5px;
        }
        .decision-description {
          margin-bottom: 5px;
        }
        .decision-reasoning {
          font-style: italic;
          margin-bottom: 5px;
        }
        .decision-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .tag {
          background-color: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.8em;
        }
        .search-box {
          width: 100%;
          padding: 5px;
          margin-bottom: 10px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        .add-decision-btn {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 5px 10px;
          cursor: pointer;
          margin-bottom: 15px;
        }
        .add-decision-form {
          display: none;
          margin-bottom: 15px;
        }
        .form-group {
          margin-bottom: 10px;
        }
        label {
          display: block;
          margin-bottom: 5px;
        }
        input, textarea {
          width: 100%;
          padding: 5px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        .form-buttons {
          display: flex;
          gap: 10px;
        }
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 5px 10px;
          cursor: pointer;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <input type="text" class="search-box" placeholder="Search decisions..." id="search-box">
      
      <button class="add-decision-btn" id="add-decision-btn">Add Decision</button>
      
      <div class="add-decision-form" id="add-decision-form">
        <div class="form-group">
          <label for="title">Title:</label>
          <input type="text" id="title" required>
        </div>
        <div class="form-group">
          <label for="description">Description:</label>
          <textarea id="description" rows="2" required></textarea>
        </div>
        <div class="form-group">
          <label for="reasoning">Reasoning:</label>
          <textarea id="reasoning" rows="3" required></textarea>
        </div>
        <div class="form-group">
          <label for="tags">Tags (comma separated):</label>
          <input type="text" id="tags">
        </div>
        <div class="form-buttons">
          <button type="button" id="save-decision-btn">Save</button>
          <button type="button" id="cancel-decision-btn">Cancel</button>
        </div>
      </div>
      
      <div id="decisions-list"></div>
      
      <script nonce="${nonce}">
        (function() {
          const vscode = acquireVsCodeApi();
          const searchBox = document.getElementById('search-box');
          const decisionsList = document.getElementById('decisions-list');
          const addDecisionBtn = document.getElementById('add-decision-btn');
          const addDecisionForm = document.getElementById('add-decision-form');
          const saveDecisionBtn = document.getElementById('save-decision-btn');
          const cancelDecisionBtn = document.getElementById('cancel-decision-btn');
          
          let decisions = [];
          
          // Handle search
          searchBox.addEventListener('input', () => {
            const query = searchBox.value.trim();
            vscode.postMessage({ type: 'getDecisions', query });
          });
          
          // Handle add decision button
          addDecisionBtn.addEventListener('click', () => {
            addDecisionForm.style.display = 'block';
            addDecisionBtn.style.display = 'none';
          });
          
          // Handle cancel button
          cancelDecisionBtn.addEventListener('click', () => {
            addDecisionForm.style.display = 'none';
            addDecisionBtn.style.display = 'block';
            clearForm();
          });
          
          // Handle save button
          saveDecisionBtn.addEventListener('click', () => {
            const title = document.getElementById('title').value.trim();
            const description = document.getElementById('description').value.trim();
            const reasoning = document.getElementById('reasoning').value.trim();
            const tagsInput = document.getElementById('tags').value.trim();
            
            if (!title || !description || !reasoning) {
              alert('Please fill in all required fields');
              return;
            }
            
            const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()) : [];
            
            const decision = {
              title,
              description,
              reasoning,
              tags
            };
            
            vscode.postMessage({ type: 'addDecision', decision });
            
            addDecisionForm.style.display = 'none';
            addDecisionBtn.style.display = 'block';
            clearForm();
          });
          
          function clearForm() {
            document.getElementById('title').value = '';
            document.getElementById('description').value = '';
            document.getElementById('reasoning').value = '';
            document.getElementById('tags').value = '';
          }
          
          function renderDecisions(decisions) {
            decisionsList.innerHTML = '';
            
            if (decisions.length === 0) {
              decisionsList.innerHTML = '<p>No decisions found. Add your first project decision!</p>';
              return;
            }
            
            decisions.forEach(decision => {
              const decisionEl = document.createElement('div');
              decisionEl.className = 'decision';
              
              const titleEl = document.createElement('div');
              titleEl.className = 'decision-title';
              titleEl.textContent = decision.title;
              decisionEl.appendChild(titleEl);
              
              const descriptionEl = document.createElement('div');
              descriptionEl.className = 'decision-description';
              descriptionEl.textContent = decision.description;
              decisionEl.appendChild(descriptionEl);
              
              const reasoningEl = document.createElement('div');
              reasoningEl.className = 'decision-reasoning';
              reasoningEl.textContent = decision.reasoning;
              decisionEl.appendChild(reasoningEl);
              
              if (decision.tags && decision.tags.length > 0) {
                const tagsEl = document.createElement('div');
                tagsEl.className = 'decision-tags';
                
                decision.tags.forEach(tag => {
                  const tagEl = document.createElement('span');
                  tagEl.className = 'tag';
                  tagEl.textContent = tag;
                  tagsEl.appendChild(tagEl);
                });
                
                decisionEl.appendChild(tagsEl);
              }
              
              decisionsList.appendChild(decisionEl);
            });
          }
          
          // Listen for messages from the extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
              case 'decisions':
                decisions = message.decisions;
                renderDecisions(decisions);
                break;
            }
          });
          
          // Initial load
          vscode.postMessage({ type: 'getDecisions' });
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
