import * as vscode from 'vscode';
import { OpenAIService } from './services/openAIService';
import { ConfigurationService } from './services/configurationService';
import { EditorService } from './services/editorService';
import { SuggestionService } from './services/suggestionService';
import { ChatViewProvider } from './panels/chatViewProvider';

export async function activate(context: vscode.ExtensionContext) {
  console.log('OpenAI Agent extension is now active');
  
  // Initialize services
  const configService = new ConfigurationService(context);
  const openAIService = new OpenAIService(configService, context.extensionUri.fsPath);
  const editorService = new EditorService();
  const suggestionService = new SuggestionService(openAIService, editorService);
  const chatViewProvider = new ChatViewProvider(openAIService, context.extensionUri);
  
  // Register commands
  const enableCommand = vscode.commands.registerCommand('vscode-openai-agent.enable', () => {
    configService.setEnabled(true);
    vscode.window.showInformationMessage('OpenAI Agent has been enabled');
  });
  
  const disableCommand = vscode.commands.registerCommand('vscode-openai-agent.disable', () => {
    configService.setEnabled(false);
    vscode.window.showInformationMessage('OpenAI Agent has been disabled');
  });
  
  const setApiKeyCommand = vscode.commands.registerCommand('vscode-openai-agent.setApiKey', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your OpenAI API key',
      password: true,
      ignoreFocusOut: true
    });
    
    if (apiKey) {
      await configService.setApiKey(apiKey);
      vscode.window.showInformationMessage('OpenAI API key has been set');
      
      // Initialize the OpenAI service with the new API key
      try {
        await openAIService.initialize();
      } catch (error) {
        // Error handling is done inside the initialize method
      }
    }
  });
  
  const resetContextCommand = vscode.commands.registerCommand('vscode-openai-agent.resetContext', async () => {
    await suggestionService.resetAssistantThread();
  });
  
  const resetAssistantCommand = vscode.commands.registerCommand('vscode-openai-agent.resetAssistant', async () => {
    await configService.resetAssistantId();
    vscode.window.showInformationMessage('OpenAI Assistant has been reset. It will be recreated on next use.');
  });
  
  

  const askCommand = vscode.commands.registerCommand('vscode-openai-agent.ask', async () => {
    suggestionService.setMode('ask');
    await suggestionService.askAtCursor();
  });
  const reloadMcpCommand = vscode.commands.registerCommand('vscode-openai-agent.reloadMcp', async () => {
    try {
      await openAIService.initialize();
      vscode.window.showInformationMessage('MCP servers reloaded');
    } catch (e: any) {
      vscode.window.showErrorMessage('Failed to reload MCP servers: ' + (e?.message || e));
    }
  });

  const showPanelCommand = vscode.commands.registerCommand('vscode-openai-agent.showPanel', async () => {
    // First show the panel, then focus on our view
    await vscode.commands.executeCommand('workbench.view.panel');
    await vscode.commands.executeCommand('openaiAgent-panel.focus');
  });

  const setModeCommand = vscode.commands.registerCommand('vscode-openai-agent.setMode', async (mode: 'agent' | 'ask') => {
    suggestionService.setMode(mode);
    vscode.window.showInformationMessage(`OpenAI Agent mode: ${mode}`);
  });

  // Register completions provider
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { pattern: '**' },
    suggestionService,
    '.',
    ' ',
    '(',
    '{',
    '[',
    '\n'
  );
  
  // Register inline completions provider if available in this VS Code version
  let inlineCompletionProvider = suggestionService.registerInlineCompletionProvider();
  
  // Add all disposables to the context
  context.subscriptions.push(
    enableCommand,
    disableCommand,
    setApiKeyCommand,
    resetContextCommand,
    resetAssistantCommand,
    askCommand,
    reloadMcpCommand,
    showPanelCommand,
    setModeCommand,
    completionProvider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatViewProvider),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.panelViewId, chatViewProvider)
  );
  
  if (inlineCompletionProvider) {
    context.subscriptions.push(inlineCompletionProvider);
  }
  
  // Check if API key is set
  if (!(await configService.getApiKey())) {
    vscode.window.showWarningMessage(
      'OpenAI API key is not set. Please set your API key to use the OpenAI Agent',
      'Set API Key'
    ).then(selection => {
      if (selection === 'Set API Key') {
        vscode.commands.executeCommand('vscode-openai-agent.setApiKey');
      }
    });
  } else {
    // Initialize OpenAI service if API key is already set
    try {
      await openAIService.initialize();
    } catch (error) {
      // Error handling is done inside the initialize method
    }
  }
}

export function deactivate() {
  console.log('OpenAI Agent extension is now deactivated');
}
