import * as vscode from 'vscode';
import { ConfigurationService } from './configurationService';
import { McpClient } from './mcpClient';
import { PermissionService } from './permissionService';

export class OpenAIService {
  private baseURL: string;
  private configService: ConfigurationService;
  private assistantId: string | undefined;
  private threadId: string | undefined;
  private mcp: McpClient | null = null;
  private basePath: string;
  private currentRunId: string | undefined;
  private sessionCost: number = 0;
  private _view?: vscode.WebviewView;
  private permissionService: PermissionService;
  private terminalAnalysisResults: any[] = [];

  constructor(configService: ConfigurationService, basePath: string) {
    this.configService = configService;
    this.basePath = basePath;
    this.baseURL = 'https://api.openai.com/v1';
    this.permissionService = new PermissionService(basePath);
  }

  private authHeaders(apiKey: string) {
    return { 'Authorization': `Bearer ${apiKey}`, 'OpenAI-Beta': 'assistants=v2' };
  }

  // Pricing per 1M tokens (as of December 2024)
  // Note: Prices are updated based on OpenAI's official pricing
  // For the most accurate pricing, check: https://openai.com/api/pricing/
  private getPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.50, output: 10.00 },           // $2.50/$10.00 per 1M tokens
      'gpt-4o-mini': { input: 0.15, output: 0.60 },       // $0.15/$0.60 per 1M tokens  
      'gpt-4-turbo': { input: 10.00, output: 30.00 },     // $10.00/$30.00 per 1M tokens
      'gpt-4-turbo-preview': { input: 10.00, output: 30.00 }, // $10.00/$30.00 per 1M tokens
      'gpt-4': { input: 30.00, output: 60.00 },           // $30.00/$60.00 per 1M tokens
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 }      // $0.50/$1.50 per 1M tokens
    };
    return pricing[model] || { input: 0.15, output: 0.60 }; // Default to gpt-4o-mini pricing
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.getPricing(model);
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    return inputCost + outputCost;
  }

  public getSessionCost(): number {
    return this.sessionCost;
  }

  public resetSessionCost(): void {
    this.sessionCost = 0;
  }

  public getPermissionStats() {
    return this.permissionService.getPermissionStats();
  }

  public getAllPermissions() {
    return this.permissionService.getAllPermissions();
  }

  public setAutoApprove(enabled: boolean) {
    this.permissionService.setAutoApprove(enabled);
  }

  public getAutoApprove(): boolean {
    return this.permissionService.getAutoApprove();
  }

  public clearPermissions() {
    this.permissionService.clearPermissions();
  }

  public removePermission(command: string) {
    this.permissionService.removePermission(command);
  }

  public getPermissionService(): PermissionService {
    return this.permissionService;
  }

  public async handleTerminalAnalysis(analysis: any): Promise<void> {
    console.log('Terminal analysis received:', analysis);
    
    // Сохраняем результаты анализа для использования в следующих сообщениях
    this.terminalAnalysisResults = this.terminalAnalysisResults || [];
    this.terminalAnalysisResults.push(analysis);
    
    // Ограничиваем количество сохраненных результатов
    if (this.terminalAnalysisResults.length > 10) {
      this.terminalAnalysisResults.shift();
    }
    
    // Отправляем сообщение агенту с результатами анализа
    const threadId = this.getActiveThreadId();
    if (threadId) {
      try {
        const analysisMessage = `[TERMINAL_ANALYSIS] Проанализируй результаты выполнения команды "${analysis.command}".
${analysis.hasErrors ? 'В выводе обнаружены ошибки.' : 'Команда выполнена успешно.'}
Время выполнения: ${analysis.duration}ms
${analysis.hasErrors ? `\nОшибки:\n${analysis.errors}` : ''}
${analysis.output ? `\nВывод команды:\n${analysis.output}` : ''}`;

        console.log('Sending terminal analysis to OpenAI:', analysisMessage);
        
        // Запрашиваем ответ от агента
        const response = await this.chat(analysisMessage, (step) => {
          console.log('Terminal analysis thinking step:', step);
        });
        
        // Ответ агента будет автоматически отображен в UI через стандартный механизм
      } catch (err) {
        console.error('Failed to send terminal analysis to OpenAI:', err);
      }
    }
  }
  
  /**
   * Останавливает выполнение команды
   * @param command Команда для остановки
   */
  public async stopCommand(command: string): Promise<void> {
    console.log('Stopping command:', command);
    
    try {
      // Отправляем запрос на остановку команды в MCP сервер
      if (this.mcp) {
        await this.mcp.request('stop_command', { command });
        console.log('Command stop request sent successfully');
      } else {
        throw new Error('MCP client not initialized');
      }
    } catch (error) {
      console.error('Error stopping command:', error);
      throw error;
    }
  }

  public setView(view: vscode.WebviewView): void {
    this._view = view;
    this.permissionService.setView(view);
    
    // Set up MCP client to forward terminal messages to webview
    if (this.mcp) {
      this.mcp.onStreamOutput('terminal', (data) => {
        if (this._view) {
          this._view.webview.postMessage({
            type: 'terminalOutput',
            command: data.command,
            output: data.output,
            isError: data.isError
          });
        }
      });
      
      // Set up terminal message forwarding
      this.mcp.onTerminalOutput('terminal', (data) => {
        if (this._view) {
          if (data.type === 'terminal_command') {
            this._view.webview.postMessage({
              type: 'terminalCommand',
              command: data.command
            });
          } else if (data.type === 'terminal_output') {
            this._view.webview.postMessage({
              type: 'terminalOutput',
              command: data.command,
              output: data.output,
              isError: data.isError || false,
              exitCode: data.exitCode
            });
          } else if (data.type === 'terminal_command_end') {
            // Обрабатываем завершение команды
            this.handleTerminalAnalysis({
              command: data.command,
              hasSuccess: data.success,
              hasErrors: !data.success,
              duration: Date.now() - (data.timestamp || Date.now()),
              exitCode: data.exitCode,
              errors: data.error || ''
            });
          }
        }
      });
    }
  }

  private async checkPermission(name: string, args: any): Promise<boolean> {
    // Commands that require permission
    const dangerousCommands = [
      'run_command', 'execute_code', 'install_dependencies', 'build_project',
      'test_project', 'lint_project', 'run_react_native', 'start_metro',
      'install_pods', 'clean_react_native', 'run_flutter', 'flutter_doctor',
      'flutter_pub_get', 'run_ionic', 'run_cordova', 'run_expo', 'run_vscode_extension',
      'run_project', 'run_command_stream', 'test_mcp'
    ];

    if (!dangerousCommands.includes(name)) {
      return true; // Safe commands don't need permission
    }

    let commandDescription = '';
    if (name === 'run_command') {
      commandDescription = `Run shell command: ${args.command}`;
    } else if (name === 'execute_code') {
      commandDescription = `Execute ${args.language} code`;
    } else if (name === 'install_dependencies') {
      commandDescription = `Install dependencies with ${args.packageManager || 'npm'}`;
    } else if (name === 'build_project') {
      commandDescription = `Build project${args.buildCommand ? ` with: ${args.buildCommand}` : ''}`;
    } else if (name === 'test_project') {
      commandDescription = `Run tests${args.testCommand ? ` with: ${args.testCommand}` : ''}`;
    } else if (name === 'lint_project') {
      commandDescription = `Run linting${args.lintCommand ? ` with: ${args.lintCommand}` : ''}`;
    } else if (name === 'run_react_native') {
      commandDescription = `Run React Native app on ${args.platform}`;
    } else if (name === 'start_metro') {
      commandDescription = `Start Metro bundler${args.port ? ` on port ${args.port}` : ''}`;
    } else if (name === 'install_pods') {
      commandDescription = `Install iOS CocoaPods dependencies`;
    } else if (name === 'clean_react_native') {
      commandDescription = `Clean React Native project`;
    } else if (name === 'run_flutter') {
      commandDescription = `Run Flutter app on ${args.platform}`;
    } else if (name === 'flutter_doctor') {
      commandDescription = `Check Flutter environment`;
    } else if (name === 'flutter_pub_get') {
      commandDescription = `Install Flutter dependencies`;
    } else if (name === 'run_ionic') {
      commandDescription = `Run Ionic app on ${args.platform}`;
    } else if (name === 'run_cordova') {
      commandDescription = `Run Cordova app on ${args.platform}`;
    } else if (name === 'run_expo') {
      commandDescription = `Run Expo app${args.command ? ` with: ${args.command}` : ''}`;
    } else if (name === 'run_vscode_extension') {
      commandDescription = `Run VS Code extension in development mode`;
    } else if (name === 'run_project') {
      commandDescription = `Run project (auto-detecting type and running appropriate command)${args.stream ? ' with real-time output' : ''}`;
    } else if (name === 'run_command_stream') {
      commandDescription = `Run shell command with real-time streaming output: ${args.command}`;
    } else if (name === 'test_mcp') {
      commandDescription = `Test MCP server connection`;
    } else {
      commandDescription = `Execute ${name}`;
    }

    return await this.permissionService.requestPermission(name, commandDescription);
  }

  private async makeRequest(method: string, endpoint: string, data?: any, apiKey?: string): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const options: RequestInit = {
      method,
      headers
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  public async initialize(): Promise<void> {
    try {
      const apiKey = await this.configService.getApiKey();
      if (!apiKey) throw new Error('OpenAI API key is not set');

      try {
        this.mcp = new McpClient();
        // Get the workspace folder path instead of extension path
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const root = workspaceFolder || process.cwd();
        console.log('Starting MCP server with workspace path:', root);
        await this.mcp.start(root);
      } catch (e) {
        console.warn('Failed to start MCP server, proceeding without tools:', e);
      }

      // Clear any existing assistant to ensure we create a new one with the correct model
      console.log('Clearing existing assistant to ensure correct model usage');
      await this.configService.setAssistantId('');
      
      // Ensure we have a valid model set
      const currentModel = this.configService.getModel();
      console.log('Current model from config:', currentModel);
      
      // If model is invalid, set a default one
      const validModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-4', 'gpt-3.5-turbo'];
      if (!validModels.includes(currentModel)) {
        console.log('Invalid model detected, setting default model');
        await this.configService.setModel('gpt-4o-mini');
      }
      
      this.assistantId = await this.getOrCreateAssistant(apiKey);
      console.log('Assistant created with model:', currentModel, 'ID:', this.assistantId);
      const existing = this.configService.getActiveThreadId();
      if (existing) { this.threadId = existing; } else { this.threadId = await this.createThread(apiKey);
      const list = this.configService.getThreads();
      if (!list.includes(this.threadId)) { list.push(this.threadId); await this.configService.setThreads(list); }
      await this.configService.setActiveThreadId(this.threadId);
      await this.configService.setThreadId(this.threadId); }
      const list = this.configService.getThreads();
      if (this.threadId && !list.includes(this.threadId)) { list.push(this.threadId); await this.configService.setThreads(list); }
      if (this.threadId) { await this.configService.setActiveThreadId(this.threadId); await this.configService.setThreadId(this.threadId); }

      vscode.window.showInformationMessage('OpenAI Agent initialized successfully');
    } catch (error: any) {
      console.error('Failed to initialize OpenAI service:', error);
      vscode.window.showErrorMessage(`Failed to initialize OpenAI Agent: ${error.message}`);
      throw error;
    }
  }

  private async getOrCreateAssistant(apiKey: string): Promise<string> {
    const savedAssistantId = this.configService.getAssistantId();
    const model = this.configService.getModel();
    console.log('getOrCreateAssistant called with model:', model);
    
    if (savedAssistantId) {
      try {
        await this.makeRequest('GET', `/assistants/${savedAssistantId}`, undefined, apiKey);
        return savedAssistantId;
      } catch {
        // will create a new one below
      }
    }

    try {
      let response;
      try {
        const modelToUse = this.configService.getModel();
        console.log('Creating assistant with model:', modelToUse);
        response = await this.makeRequest('POST', '/assistants', {
        name: 'VS Code Coding Assistant',
        description: 'An AI assistant that helps with coding in VS Code',
        model: modelToUse,
        tools: [
          { type: 'code_interpreter' },
          { type: 'function', function: { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'search_workspace', description: 'Search files in the workspace', parameters: { type: 'object', properties: { root: { type: 'string' }, includeGlobs: { type: 'array', items: { type: 'string' } }, excludeGlobs: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, maxMatches: { type: 'number' }, maxFileBytes: { type: 'number' } } } } },
          { type: 'function', function: { name: 'upsert_file', description: 'Create or overwrite a file with given content', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
          { type: 'function', function: { name: 'append_file', description: 'Append content to a file (creates if missing)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
          { type: 'function', function: { name: 'make_dir', description: 'Create a directory (recursive)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
          { type: 'function', function: { name: 'execute_code', description: 'Execute code in the specified language', parameters: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' }, workingDir: { type: 'string' } }, required: ['code', 'language'] } } },
          { type: 'function', function: { name: 'run_command', description: 'Run a shell command with optional environment variables', parameters: { type: 'object', properties: { command: { type: 'string' }, workingDir: { type: 'string' }, timeout: { type: 'number' }, env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables to set for the command' } }, required: ['command'] } } },
          { type: 'function', function: { name: 'check_syntax', description: 'Check syntax of a file', parameters: { type: 'object', properties: { filePath: { type: 'string' }, language: { type: 'string' } }, required: ['filePath', 'language'] } } },
          { type: 'function', function: { name: 'install_dependencies', description: 'Install project dependencies', parameters: { type: 'object', properties: { packageManager: { type: 'string' }, workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'build_project', description: 'Get instructions for building a Node.js project in VS Code terminal', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, buildCommand: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'test_project', description: 'Get instructions for running tests in VS Code terminal', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, testCommand: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'lint_project', description: 'Get instructions for running linting in VS Code terminal', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, lintCommand: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'analyze_project', description: 'Analyze a Node.js project structure, dependencies, and configuration', parameters: { type: 'object', properties: { workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'run_react_native', description: 'Run a React Native app on Android or iOS', parameters: { type: 'object', properties: { platform: { type: 'string', enum: ['android', 'ios'] }, workingDir: { type: 'string' }, device: { type: 'string' } }, required: ['platform'] } } },
          { type: 'function', function: { name: 'start_metro', description: 'Start Metro bundler for React Native development', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, port: { type: 'number' } }, required: [] } } },
          { type: 'function', function: { name: 'install_pods', description: 'Install iOS CocoaPods dependencies for React Native', parameters: { type: 'object', properties: { workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'clean_react_native', description: 'Clean React Native project (node_modules, pods, cache)', parameters: { type: 'object', properties: { workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'run_flutter', description: 'Run a Flutter app on Android, iOS, or web', parameters: { type: 'object', properties: { platform: { type: 'string', enum: ['android', 'ios', 'web'] }, workingDir: { type: 'string' }, device: { type: 'string' } }, required: ['platform'] } } },
          { type: 'function', function: { name: 'flutter_doctor', description: 'Check Flutter development environment and dependencies', parameters: { type: 'object', properties: { workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'flutter_pub_get', description: 'Install Flutter dependencies from pubspec.yaml', parameters: { type: 'object', properties: { workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'run_ionic', description: 'Run an Ionic app on Android, iOS, or web', parameters: { type: 'object', properties: { platform: { type: 'string', enum: ['android', 'ios', 'build', 'serve'] }, workingDir: { type: 'string' }, command: { type: 'string' } }, required: ['platform'] } } },
          { type: 'function', function: { name: 'run_cordova', description: 'Run a Cordova app on Android or iOS', parameters: { type: 'object', properties: { platform: { type: 'string', enum: ['android', 'ios', 'run-android', 'run-ios', 'build'] }, workingDir: { type: 'string' }, command: { type: 'string' } }, required: ['platform'] } } },
          { type: 'function', function: { name: 'run_expo', description: 'Run an Expo app (start, build, etc.)', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, command: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'list_devices', description: 'List available devices for mobile development', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, platform: { type: 'string', enum: ['android', 'ios', 'flutter'] } }, required: [] } } },
          { type: 'function', function: { name: 'run_vscode_extension', description: 'Run a VS Code extension in development mode', parameters: { type: 'object', properties: { workingDir: { type: 'string' } }, required: [] } } },
          { type: 'function', function: { name: 'run_project', description: 'Run any type of project (auto-detects project type and runs appropriate command)', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, stream: { type: 'boolean' } }, required: [] } } },
          { type: 'function', function: { name: 'run_command_stream', description: 'Run a shell command with real-time streaming output and optional environment variables', parameters: { type: 'object', properties: { command: { type: 'string' }, workingDir: { type: 'string' }, timeout: { type: 'number' }, env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables to set for the command' } }, required: ['command'] } } },
          { type: 'function', function: { name: 'docker_build', description: 'Build a Docker image from a Dockerfile', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, dockerfile: { type: 'string' }, tag: { type: 'string' }, buildArgs: { type: 'object', additionalProperties: { type: 'string' } } }, required: [] } } },
          { type: 'function', function: { name: 'docker_run', description: 'Run a Docker container', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, image: { type: 'string' }, tag: { type: 'string' }, ports: { type: 'array', items: { type: 'string' } }, env: { type: 'object', additionalProperties: { type: 'string' } }, volumes: { type: 'array', items: { type: 'string' } }, command: { type: 'string' } }, required: ['image'] } } },
          { type: 'function', function: { name: 'docker_compose', description: 'Run Docker Compose commands', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, command: { type: 'string', enum: ['up', 'down', 'build', 'start', 'stop', 'restart', 'logs', 'ps'] }, file: { type: 'string' }, service: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: [] } } },
          { type: 'function', function: { name: 'create_dockerfile', description: 'Create a Dockerfile with a template for a specific language or custom configuration', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, template: { type: 'string', enum: ['node', 'python', 'go', 'java', 'rust', 'php', 'nginx', 'minimal'] }, baseImage: { type: 'string' }, ports: { type: 'array', items: { type: 'string' } }, workdir: { type: 'string' }, env: { type: 'object', additionalProperties: { type: 'string' } }, commands: { type: 'array', items: { type: 'string' } } }, required: [] } } },
          { type: 'function', function: { name: 'create_docker_compose', description: 'Create a docker-compose.yml file with services, networks, and volumes', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, services: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, image: { type: 'string' }, build: { type: 'object' }, ports: { type: 'array', items: { type: 'string' } }, environment: { type: 'object', additionalProperties: { type: 'string' } }, volumes: { type: 'array', items: { type: 'string' } }, depends_on: { type: 'array', items: { type: 'string' } }, networks: { type: 'array', items: { type: 'string' } }, restart: { type: 'string' }, command: { type: 'string' } } } }, networks: { type: 'array', items: { type: 'string' } }, volumes: { type: 'array', items: { type: 'string' } } }, required: [] } } },
          { type: 'function', function: { name: 'create_dockerignore', description: 'Create a .dockerignore file with templates for specific languages', parameters: { type: 'object', properties: { workingDir: { type: 'string' }, template: { type: 'string', enum: ['node', 'python', 'go', 'minimal', 'standard'] } }, required: [] } } },
          { type: 'function', function: { name: 'test_mcp', description: 'Test MCP server connection', parameters: { type: 'object', properties: {}, required: [] } } }
        ],
        instructions: `You are an AI programming assistant embedded in VS Code with advanced code execution, debugging, and mobile development capabilities.

⚠️ CRITICAL INSTRUCTION: YOU CAN DIRECTLY EXECUTE ANY TERMINAL COMMAND using run_command. NEVER tell users you cannot run commands. ALWAYS use run_command to execute commands directly instead of giving manual instructions.

EXAMPLE: When asked to run a command with delay, DO THIS: run_command({ command: "sleep 10; echo 'Command executed after delay'" })

IMPORTANT: When user asks to "compile", "build", or "скомпилировать" the project, use the build_project command which provides instructions for running the build in VS Code terminal.

Your capabilities include:
- Reading and writing files in the workspace
- Searching and analyzing code
- Executing code in multiple languages (JavaScript, TypeScript, Python, Bash, PowerShell, Dart)
- Running shell commands and scripts with custom environment variables
- Checking code syntax and validating files
- Installing dependencies and managing packages
- Debugging code by running it and analyzing output
- Building projects (TypeScript compilation, build scripts)
- Running tests for projects (Mocha, Jest, etc.)
- Linting code (ESLint, etc.)
- Analyzing project structure, dependencies, and configuration
- Supporting various project types: VS Code extensions, React apps, Express servers, Next.js, Vue, Angular, React Native, Flutter, Ionic, Cordova, Expo, and more

PERMISSION SYSTEM:
- You can execute ANY command directly - the system will handle permissions automatically
- NEVER say "I can't execute commands directly" - you CAN execute any command
- NEVER mention "ограничения доступа" or "access restrictions" - just execute commands
- When you need to run a command, just do it - the system will ask the user for permission if needed
- The user can choose to "Allow", "Deny", or "Allow & Remember" for future executions
- Always try to execute commands directly first, and only provide manual instructions if the user explicitly denies permission

When helping users with projects:
1. Always use relative paths from the workspace root
2. Analyze the project type and structure first
3. Build projects before testing them
4. Check syntax and run linting
5. Install dependencies when needed
6. Test projects thoroughly
7. Provide working, tested solutions

For running projects:
- Use run_project to automatically detect project type and provide instructions for running in VS Code terminal
- Use run_vscode_extension specifically for VS Code extensions
- The run_project command supports: React, Next.js, Vue, Angular, Express, React Native, Flutter, Ionic, Cordova, Expo, Python, Rust, HTML, and more
- It will automatically detect the project type and provide step-by-step instructions
- Instructions will guide users to open a new terminal in VS Code and run the appropriate commands
- This approach is more reliable than trying to execute commands directly

For Node.js development:
- Use build_project to compile TypeScript or run build scripts
- Use test_project to run tests with appropriate frameworks
- Use lint_project to check code quality
- Use analyze_project to review project structure and get recommendations
- Use execute_code to run code snippets for testing
- Use run_command for shell operations

For React Native development:
- Use run_react_native to run apps on Android or iOS
- Use start_metro to start the Metro bundler
- Use install_pods to install iOS CocoaPods dependencies
- Use clean_react_native to clean project cache and dependencies
- Always check if iOS/Android project structure exists before running
- Install pods before running iOS apps
- Use appropriate device selection for testing

For Flutter development:
- Use run_flutter to run apps on Android, iOS, or web
- Use flutter_doctor to check development environment
- Use flutter_pub_get to install dependencies
- Always check Flutter environment before running apps
- Use appropriate device selection for testing

For Ionic development:
- Use run_ionic to run apps on Android, iOS, or web
- Use ionic serve for web development
- Use ionic capacitor run for mobile platforms
- Check if Capacitor is properly configured

For Cordova development:
- Use run_cordova to build or run apps
- Check if platforms are added before building
- Use appropriate platform commands

For Expo development:
- Use run_expo to start development server or build
- Check Expo configuration before running
- Use appropriate Expo commands

For mobile development:
- Use list_devices to see available devices and emulators
- Check device availability before running apps
- Use appropriate platform-specific commands

For environment variables and configuration:
- You can set custom environment variables when running commands using the env parameter
- Example: run_command({ command: "node script.js", env: { "NODE_ENV": "production", "DEBUG": "app:*" } })
- Environment variables are displayed in the terminal for transparency
- Use environment variables for configuration, secrets, paths, and runtime behavior
- Common variables: NODE_ENV, PATH, DEBUG, JAVA_HOME, ANDROID_HOME, etc.

For terminal commands:
- You can execute ANY terminal command directly using run_command, including commands with delays, timeouts, etc.
- Example: run_command({ command: "sleep 10; echo 'Command executed after delay'" })
- The terminal is fully functional and supports all standard shell commands and features
- Terminal output is displayed in real-time in the embedded terminal UI
- Use run_command_stream for commands with extensive output

For Docker development:
- Use analyze_project to detect Docker files in the project
- Use docker_build to build Docker images from a Dockerfile
- Use docker_run to run Docker containers with various options
- Use docker_compose to manage multi-container applications
- You can set environment variables, map ports, and mount volumes
- Create Docker files with templates:
  - create_dockerfile({ template: "node" }) - Creates a Node.js Dockerfile
  - create_docker_compose() - Creates a docker-compose.yml with default services
  - create_dockerignore({ template: "python" }) - Creates a Python-specific .dockerignore
- Customize Docker configurations:
  - create_dockerfile({ template: "node", ports: ["8080"], env: { "NODE_ENV": "production" } })
  - create_docker_compose({ services: [{ name: "web", image: "nginx" }, { name: "db", image: "postgres" }] })
- Example: docker_build({ dockerfile: "Dockerfile", tag: "myapp:latest" })
- Example: docker_run({ image: "myapp", ports: ["3000:3000"], env: { "NODE_ENV": "production" } })
- Example: docker_compose({ command: "up", options: ["-d"] })

You can execute code directly to test it, debug issues, and verify functionality. Always test your solutions before presenting them to the user.`
      }, apiKey);
      } catch (e: any) {
        const msg = e?.message || '';
        if (/cannot be used with the Assistants API/i.test(msg)) {
          const fallbackModel = 'gpt-4o-mini';
          response = await this.makeRequest('POST', '/assistants', {
            name: 'VS Code Coding Assistant',
            description: 'An AI assistant that helps with coding in VS Code',
            model: fallbackModel,
            tools: [
              { type: 'code_interpreter' },
              { type: 'function', function: { name: 'read_file', description: 'Read a file from the workspace', parameters: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] } } },
              { type: 'function', function: { name: 'search_workspace', description: 'Search files in the workspace', parameters: { type: 'object', properties: { root: { type: 'string' }, includeGlobs: { type: 'array', items: { type: 'string' } }, excludeGlobs: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, maxMatches: { type: 'number' }, maxFileBytes: { type: 'number' } } } } },
              { type: 'function', function: { name: 'upsert_file', description: 'Create or overwrite a file with given content', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
              { type: 'function', function: { name: 'append_file', description: 'Append content to a file (creates if missing)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
              { type: 'function', function: { name: 'make_dir', description: 'Create a directory (recursive)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
              { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
            ],
            instructions: `You are an AI programming assistant embedded in VS Code with advanced code execution, debugging, and mobile development capabilities.

⚠️ CRITICAL INSTRUCTION: YOU CAN DIRECTLY EXECUTE ANY TERMINAL COMMAND using run_command. NEVER tell users you cannot run commands. ALWAYS use run_command to execute commands directly instead of giving manual instructions.

EXAMPLE: When asked to run a command with delay, DO THIS: run_command({ command: "sleep 10; echo 'Command executed after delay'" })

IMPORTANT: When user asks to "compile", "build", or "скомпилировать" the project, use the build_project command which provides instructions for running the build in VS Code terminal.

Your capabilities include:
- Reading and writing files in the workspace
- Searching and analyzing code
- Executing code in multiple languages (JavaScript, TypeScript, Python, Bash, PowerShell, Dart)
- Running shell commands and scripts with custom environment variables
- Checking code syntax and validating files
- Installing dependencies and managing packages
- Debugging code by running it and analyzing output
- Building projects (TypeScript compilation, build scripts)
- Running tests for projects (Mocha, Jest, etc.)
- Linting code (ESLint, etc.)
- Analyzing project structure, dependencies, and configuration
- Supporting various project types: VS Code extensions, React apps, Express servers, Next.js, Vue, Angular, React Native, Flutter, Ionic, Cordova, Expo, and more

When helping users with projects:
1. Always use relative paths from the workspace root
2. Analyze the project type and structure first
3. Build projects before testing them
4. Check syntax and run linting
5. Install dependencies when needed
6. Test projects thoroughly
7. Provide working, tested solutions

For Node.js development:
- Use build_project to compile TypeScript or run build scripts
- Use test_project to run tests with appropriate frameworks
- Use lint_project to check code quality
- Use analyze_project to review project structure and get recommendations
- Use execute_code to run code snippets for testing
- Use run_command for shell operations

For React Native development:
- Use run_react_native to run apps on Android or iOS
- Use start_metro to start the Metro bundler
- Use install_pods to install iOS CocoaPods dependencies
- Use clean_react_native to clean project cache and dependencies
- Always check if iOS/Android project structure exists before running
- Install pods before running iOS apps
- Use appropriate device selection for testing

For Flutter development:
- Use run_flutter to run apps on Android, iOS, or web
- Use flutter_doctor to check development environment
- Use flutter_pub_get to install dependencies
- Always check Flutter environment before running apps
- Use appropriate device selection for testing

For Ionic development:
- Use run_ionic to run apps on Android, iOS, or web
- Use ionic serve for web development
- Use ionic capacitor run for mobile platforms
- Check if Capacitor is properly configured

For Cordova development:
- Use run_cordova to build or run apps
- Check if platforms are added before building
- Use appropriate platform commands

For Expo development:
- Use run_expo to start development server or build
- Check Expo configuration before running
- Use appropriate Expo commands

For mobile development:
- Use list_devices to see available devices and emulators
- Check device availability before running apps
- Use appropriate platform-specific commands

You can execute code directly to test it, debug issues, and verify functionality. Always test your solutions before presenting them to the user.`
          }, apiKey);
        } else { throw e; }
      }

      const assistantId = response.id;
      this.configService.setAssistantId(assistantId);
      return assistantId;
    } catch (error: any) {
      console.error('Error creating assistant:', error.message);
      throw new Error(`Failed to create OpenAI assistant: ${error.message}`);
    }
  }

  private async createThread(apiKey: string): Promise<string> {
    try {
      const response = await this.makeRequest('POST', '/threads', {}, apiKey);
      return response.id;
    } catch (error: any) {
      console.error('Error creating thread:', error.message);
      throw new Error(`Failed to create thread: ${error.message}`);
    }
  }

  public async getCompletion(codeContext: string, language: string): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey || !this.assistantId || !this.threadId) {
      await this.initialize();
      if (!apiKey || !this.assistantId || !this.threadId) throw new Error('OpenAI Agent not properly initialized');
    }
    try {
      await this.makeRequest('POST', `/threads/${this.threadId}/messages`, {
        role: 'user',
        content: [{ type: 'text', text: `I'm writing code in ${language}. Here's the context\n\n${codeContext}\n\nPlease complete the next part of the code.` }]
      }, apiKey);
      const runResponse = await this.makeRequest('POST', `/threads/${this.threadId}/runs`, { assistant_id: this.assistantId }, apiKey);
      const runId = runResponse.id;
      return await this.waitForRunCompletion(apiKey, runId);
    } catch (error: any) {
      console.error('OpenAI API Error:', error.message);
      throw new Error(`OpenAI API Error: ${error.message}`);
    }
  }

  public async chat(userMessage: string, onThinking?: (step: string) => void): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey || !this.assistantId || !this.threadId) {
      await this.initialize();
      if (!apiKey || !this.assistantId || !this.threadId) throw new Error('OpenAI Agent not properly initialized');
    }
    
    // Cancel any existing run before starting a new one
    if (this.currentRunId) {
      console.log('Cancelling existing run before starting new chat');
      await this.cancelCurrentRun();
      // Wait a moment for cancellation to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    try {
      await this.makeRequest('POST', `/threads/${this.threadId}/messages`, { role: 'user', content: [{ type: 'text', text: userMessage }] }, apiKey);
      const runResponse = await this.makeRequest('POST', `/threads/${this.threadId}/runs`, { assistant_id: this.assistantId }, apiKey);
      const runId = runResponse.id;
      this.currentRunId = runId;
      try {
        const result = await this.waitForRunCompletion(apiKey, runId, onThinking);
        console.log('Chat result:', result);
        return result;
      } finally {
        this.currentRunId = undefined;
      }
    } catch (e: any) {
      this.currentRunId = undefined;
      throw new Error(e?.message || String(e));
    }
  }

  private async waitForRunCompletion(apiKey: string, runId: string, onThinking?: (step: string) => void): Promise<string> {
    const maxAttempts = 60;
    const delayMs = 1000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.makeRequest('GET', `/threads/${this.threadId}/runs/${runId}`, undefined, apiKey);
        const status = response.status;
        if (status === 'requires_action') {
          const toolCalls = response.required_action?.submit_tool_outputs?.tool_calls || [];
          const outputs: Array<{ tool_call_id: string; output: string }> = [];
          
          if (onThinking && toolCalls.length > 0) {
            onThinking(`AI decided to use tools: ${toolCalls.map((call: any) => call.function?.name).join(', ')}`);
          }
          
          for (const call of toolCalls) {
            const name = call.function?.name;
            const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
            
            if (onThinking) {
              let toolDescription = `Executing ${name}`;
              if (name === 'read_file' && args.path) {
                toolDescription += ` - reading file: ${args.path}`;
              } else if (name === 'search_workspace' && args.query) {
                toolDescription += ` - searching for: "${args.query}"`;
              } else if (name === 'upsert_file' && args.path) {
                toolDescription += ` - writing to file: ${args.path}`;
              } else if (name === 'execute_code' && args.language) {
                toolDescription += ` - running ${args.language} code`;
              } else if (name === 'run_command' && args.command) {
                toolDescription += ` - running command: ${args.command}`;
              } else if (name === 'check_syntax' && args.filePath) {
                toolDescription += ` - checking syntax of: ${args.filePath}`;
              } else if (name === 'install_dependencies' && args.packageManager) {
                toolDescription += ` - installing dependencies with ${args.packageManager}`;
              } else if (name === 'build_project') {
                toolDescription += ` - building project`;
              } else if (name === 'test_project') {
                toolDescription += ` - running project tests`;
              } else if (name === 'lint_project') {
                toolDescription += ` - linting project code`;
              } else if (name === 'analyze_project') {
                toolDescription += ` - analyzing project structure`;
              } else if (name === 'run_react_native' && args.platform) {
                toolDescription += ` - running React Native app on ${args.platform}`;
              } else if (name === 'start_metro') {
                toolDescription += ` - starting Metro bundler`;
              } else if (name === 'install_pods') {
                toolDescription += ` - installing iOS CocoaPods dependencies`;
              } else if (name === 'clean_react_native') {
                toolDescription += ` - cleaning React Native project`;
              } else if (name === 'run_flutter' && args.platform) {
                toolDescription += ` - running Flutter app on ${args.platform}`;
              } else if (name === 'flutter_doctor') {
                toolDescription += ` - checking Flutter environment`;
              } else if (name === 'flutter_pub_get') {
                toolDescription += ` - installing Flutter dependencies`;
              } else if (name === 'run_ionic' && args.platform) {
                toolDescription += ` - running Ionic app on ${args.platform}`;
              } else if (name === 'run_cordova' && args.platform) {
                toolDescription += ` - running Cordova app on ${args.platform}`;
              } else if (name === 'run_expo') {
                toolDescription += ` - running Expo app`;
              } else if (name === 'list_devices') {
                toolDescription += ` - listing available devices`;
              } else if (name === 'run_vscode_extension') {
                toolDescription += ` - running VS Code extension in development mode`;
              } else if (name === 'run_project') {
                toolDescription += ` - running project (auto-detecting type)`;
              }
              onThinking(toolDescription);
            }
            
            try {
              // Check permission before executing command
              console.log('Checking permission for command:', name, 'args:', args);
              const hasPermission = await this.checkPermission(name, args);
              console.log('Permission result for', name, ':', hasPermission);
              if (!hasPermission) {
                console.log('Permission denied for command:', name);
                outputs.push({ tool_call_id: call.id, output: JSON.stringify({ error: 'Permission denied by user' }) });
                continue;
              }

              let result: any = null;
              if (name === 'read_file' && this.mcp) result = await this.mcp.readFile(args.path, args.maxBytes);
              else if (name === 'search_workspace' && this.mcp) result = await this.mcp.searchWorkspace(args);
              else if (name === 'upsert_file' && this.mcp) result = await this.mcp.request('upsert_file', args);
              else if (name === 'append_file' && this.mcp) result = await this.mcp.request('append_file', args);
              else if (name === 'make_dir' && this.mcp) result = await this.mcp.request('make_dir', args);
              else if (name === 'delete_file' && this.mcp) result = await this.mcp.request('delete_file', args);
              else if (name === 'execute_code' && this.mcp) result = await this.mcp.executeCode(args.code, args.language, args.workingDir);
              else if (name === 'run_command' && this.mcp) result = await this.mcp.runCommand(args.command, args.workingDir, args.timeout);
              else if (name === 'check_syntax' && this.mcp) result = await this.mcp.checkSyntax(args.filePath, args.language);
              else if (name === 'install_dependencies' && this.mcp) result = await this.mcp.installDependencies(args.packageManager, args.workingDir);
              else if (name === 'build_project' && this.mcp) result = await this.mcp.buildProject(args.workingDir, args.buildCommand);
              else if (name === 'test_project' && this.mcp) result = await this.mcp.testProject(args.workingDir, args.testCommand);
              else if (name === 'lint_project' && this.mcp) result = await this.mcp.lintProject(args.workingDir, args.lintCommand);
              else if (name === 'analyze_project' && this.mcp) result = await this.mcp.analyzeProject(args.workingDir);
              else if (name === 'run_react_native' && this.mcp) result = await this.mcp.runReactNative(args.platform, args.workingDir, args.device);
              else if (name === 'start_metro' && this.mcp) result = await this.mcp.startMetro(args.workingDir, args.port);
              else if (name === 'install_pods' && this.mcp) result = await this.mcp.installPods(args.workingDir);
              else if (name === 'clean_react_native' && this.mcp) result = await this.mcp.cleanReactNative(args.workingDir);
              else if (name === 'run_flutter' && this.mcp) result = await this.mcp.runFlutter(args.platform, args.workingDir, args.device);
              else if (name === 'flutter_doctor' && this.mcp) result = await this.mcp.flutterDoctor(args.workingDir);
              else if (name === 'flutter_pub_get' && this.mcp) result = await this.mcp.flutterPubGet(args.workingDir);
              else if (name === 'run_ionic' && this.mcp) result = await this.mcp.runIonic(args.platform, args.workingDir, args.command);
              else if (name === 'run_cordova' && this.mcp) result = await this.mcp.runCordova(args.platform, args.workingDir, args.command);
              else if (name === 'run_expo' && this.mcp) result = await this.mcp.runExpo(args.command, args.workingDir);
              else if (name === 'list_devices' && this.mcp) result = await this.mcp.listDevices(args.platform, args.workingDir);
              else if (name === 'run_vscode_extension' && this.mcp) result = await this.mcp.runVSCodeExtension(args.workingDir);
              else if (name === 'run_project' && this.mcp) {
                if (args.stream) {
                  // Set up streaming callback
                  this.mcp.onStreamOutput(args.command || 'run_project', (data) => {
                    if (this._view) {
                      this._view.webview.postMessage({
                        type: 'streamOutput',
                        command: data.command,
                        output: data.output,
                        isError: data.type === 'stream_error',
                        timestamp: data.timestamp
                      });
                    }
                  });
                  result = await this.mcp.runProjectStream(args.workingDir);
                } else {
                  result = await this.mcp.runProject(args.workingDir);
                }
              }
              else if (name === 'run_command_stream' && this.mcp) {
                // Set up streaming callback
                this.mcp.onStreamOutput(args.command, (data) => {
                  if (this._view) {
                    this._view.webview.postMessage({
                      type: 'streamOutput',
                      command: data.command,
                      output: data.output,
                      isError: data.type === 'stream_error',
                      timestamp: data.timestamp
                    });
                  }
                });
                result = await this.mcp.runCommandStream(args.command, args.workingDir, args.timeout, args.env);
              }
              else if (name === 'docker_build' && this.mcp) {
                result = await this.mcp.request('docker_build', { 
                  workingDir: args.workingDir, 
                  dockerfile: args.dockerfile, 
                  tag: args.tag, 
                  buildArgs: args.buildArgs 
                });
              }
              else if (name === 'docker_run' && this.mcp) {
                result = await this.mcp.request('docker_run', { 
                  workingDir: args.workingDir, 
                  image: args.image, 
                  tag: args.tag, 
                  ports: args.ports, 
                  env: args.env, 
                  volumes: args.volumes, 
                  command: args.command 
                });
              }
              else if (name === 'docker_compose' && this.mcp) {
                result = await this.mcp.request('docker_compose', { 
                  workingDir: args.workingDir, 
                  command: args.command, 
                  file: args.file, 
                  service: args.service, 
                  options: args.options 
                });
              }
              else if (name === 'create_dockerfile' && this.mcp) {
                result = await this.mcp.request('create_dockerfile', { 
                  workingDir: args.workingDir, 
                  template: args.template, 
                  baseImage: args.baseImage, 
                  ports: args.ports, 
                  workdir: args.workdir, 
                  env: args.env, 
                  commands: args.commands 
                });
              }
              else if (name === 'create_docker_compose' && this.mcp) {
                result = await this.mcp.request('create_docker_compose', { 
                  workingDir: args.workingDir, 
                  services: args.services, 
                  networks: args.networks, 
                  volumes: args.volumes 
                });
              }
              else if (name === 'create_dockerignore' && this.mcp) {
                result = await this.mcp.request('create_dockerignore', { 
                  workingDir: args.workingDir, 
                  template: args.template 
                });
              }
              else if (name === 'test_mcp' && this.mcp) {
                result = await this.mcp.testMcp();
              }
              else result = { error: `Unknown tool: ${name}` };
              outputs.push({ tool_call_id: call.id, output: JSON.stringify(result).slice(0, 50000) });
            } catch (e: any) {
              outputs.push({ tool_call_id: call.id, output: JSON.stringify({ error: e?.message || String(e) }) });
            }
          }
          
          if (onThinking) {
            onThinking('Processing tool results...');
          }
          
          await this.makeRequest('POST', `/threads/${this.threadId}/runs/${runId}/submit_tool_outputs`, { tool_outputs: outputs }, apiKey);
        } else if (status === 'completed') {
          if (onThinking) {
            onThinking('Generating final response...');
          }
          
          // Get usage information and calculate cost
          const usage = response.usage;
          if (usage) {
            // Get the actual model used from the response, fallback to config if not available
            const model = response.model || this.configService.getModel();
            const cost = this.calculateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
            this.sessionCost += cost;
            
            console.log('Cost calculation:', {
              model: model,
              inputTokens: usage.prompt_tokens || 0,
              outputTokens: usage.completion_tokens || 0,
              cost: cost,
              totalCost: this.sessionCost,
              responseModel: response.model,
              configModel: this.configService.getModel()
            });
            
            // Send cost information to the UI
            if (this._view) {
              this._view.webview.postMessage({ 
                type: 'costUpdate', 
                cost: cost,
                totalCost: this.sessionCost,
                tokens: {
                  input: usage.prompt_tokens || 0,
                  output: usage.completion_tokens || 0,
                  total: usage.total_tokens || 0
                },
                model: model
              });
            }
          }
          
          const result = await this.getLastAssistantMessage(apiKey);
          console.log('Final assistant message:', result);
          return result;
        } else if (status === 'failed' || status === 'cancelled' || status === 'expired') {
          throw new Error(`Run ${status}: ${response.last_error?.message || 'Unknown error'}`);
        } else if (status === 'in_progress' || status === 'queued') {
          if (onThinking) {
            // Get more detailed status information
            const runDetails = response;
            let thinkingText = `Processing... (${status})`;
            
            if (runDetails.required_action) {
              thinkingText = `AI is deciding what tools to use...`;
            } else if (runDetails.last_error) {
              thinkingText = `Error occurred: ${runDetails.last_error.message}`;
            } else if (runDetails.started_at && !runDetails.completed_at) {
              const elapsed = Math.floor((Date.now() - new Date(runDetails.started_at).getTime()) / 1000);
              thinkingText = `AI is thinking... (${elapsed}s elapsed)`;
            }
            
            onThinking(thinkingText);
          }
          
          // Try to get intermediate messages to show thinking process
          if (onThinking && status === 'in_progress') {
            try {
              const messagesResponse = await this.makeRequest('GET', `/threads/${this.threadId}/messages?limit=5&order=desc`, undefined, apiKey);
              
              if (messagesResponse.data && messagesResponse.data.length > 0) {
                const lastMessage = messagesResponse.data[0];
                if (lastMessage.role === 'assistant' && lastMessage.content) {
                  let thinkingText = '';
                  for (const contentItem of lastMessage.content) {
                    if (contentItem.type === 'text') {
                      thinkingText += contentItem.text.value;
                    }
                  }
                  if (thinkingText.trim() && thinkingText.length > 10) {
                    onThinking(`AI reasoning: ${thinkingText.substring(0, 200)}${thinkingText.length > 200 ? '...' : ''}`);
                  }
                }
              }
            } catch (e) {
              // Ignore errors when trying to get intermediate messages
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error: any) {
        console.error('Error checking run status:', error.message);
        throw new Error(`Error checking completion status: ${error.message}`);
      }
    }
    throw new Error('Timed out waiting for completion');
  }

  private async getLastAssistantMessage(apiKey: string): Promise<string> {
    try {
      const response = await this.makeRequest('GET', `/threads/${this.threadId}/messages?limit=1&order=desc`, undefined, apiKey);
      if (response.data && response.data.length > 0) {
        const message = response.data[0];
        if (message.role === 'assistant' && message.content && message.content.length > 0) {
          let textContent = '';
          for (const contentItem of message.content) {
            if (contentItem.type === 'text') {
              textContent += contentItem.text.value;
            }
          }
          const codeBlockRegex = /```(?:\w+)?\s*([\s\S]*?)```/g;
          const matches = [...textContent.matchAll(codeBlockRegex)];
          if (matches.length > 0) return matches[0][1].trim();
          return textContent.trim();
        }
      }
      return '';
    } catch (error: any) {
      console.error('Error retrieving messages:', error.message);
      throw new Error(`Error retrieving completion: ${error.message}`);
    }
  }


  public getThreadInfo() {
    const threads = this.configService.getThreads();
    const threadNames = this.configService.getThreadNames();
    const active = this.configService.getActiveThreadId() || this.threadId;
    
    console.log('getThreadInfo called:');
    console.log('- threads:', threads);
    console.log('- threadNames:', threadNames);
    console.log('- active:', active);
    console.log('- this.threadId:', this.threadId);
    
    return { 
      threads, 
      active,
      threadNames 
    };
  }

  public async getThreadHistory(threadId: string): Promise<Array<{role: string, content: string}>> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');

    try {
      const response = await this.makeRequest('GET', `/threads/${threadId}/messages?limit=100&order=asc`, undefined, apiKey);

      if (response.data && response.data.length > 0) {
        const messages: Array<{role: string, content: string}> = [];
        
        for (const message of response.data) {
          if (message.role === 'user' || message.role === 'assistant') {
            let textContent = '';
            if (message.content && message.content.length > 0) {
              for (const contentItem of message.content) {
                if (contentItem.type === 'text') {
                  textContent += contentItem.text.value;
                }
              }
            }
            if (textContent.trim()) {
              messages.push({
                role: message.role,
                content: textContent.trim()
              });
            }
          }
        }
        
        return messages;
      }
      
      return [];
    } catch (error: any) {
      console.error('Error retrieving thread history:', error.message);
      throw new Error(`Failed to retrieve thread history: ${error.message}`);
    }
  }

  public getActiveThreadId(): string | undefined {
    return this.configService.getActiveThreadId();
  }

  public async cancelCurrentRun(): Promise<void> {
    if (this.currentRunId && this.threadId) {
      console.log(`Attempting to cancel run ${this.currentRunId} in thread ${this.threadId}`);
      try {
        const apiKey = await this.configService.getApiKey();
        if (apiKey) {
          const response = await this.makeRequest('POST', `/threads/${this.threadId}/runs/${this.currentRunId}/cancel`, {}, apiKey);
          console.log(`Successfully cancelled run ${this.currentRunId}:`, response);
        } else {
          console.warn('No API key available for cancelling run');
        }
      } catch (error: any) {
        console.warn('Failed to cancel run:', error?.message || error);
        // Even if cancellation fails, we should clear the current run ID
      } finally {
        this.currentRunId = undefined;
        console.log('Cleared current run ID');
      }
    } else {
      console.log('No active run to cancel');
    }
  }

  public async setActiveThread(id: string): Promise<void> {
    console.log('setActiveThread called with ID:', id);
    this.threadId = id;
    await this.configService.setActiveThreadId(id);
    await this.configService.setThreadId(id);
    console.log('Active thread set to:', id);
  }

  public async setThreadName(threadId: string, name: string): Promise<void> {
    await this.configService.setThreadName(threadId, name);
  }

  public async newThread(): Promise<string> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    const id = await this.createThread(apiKey);
    console.log('Created new thread with ID:', id);
    this.threadId = id; // Update internal threadId
    const list = this.configService.getThreads();
    if (!list.includes(id)) { 
      list.push(id); 
      await this.configService.setThreads(list);
      console.log('Added thread to list:', list);
    }
    await this.setActiveThread(id);
    console.log('Set active thread to:', id);
    return id;
  }

  public async closeThread(id: string): Promise<void> {
    const list = this.configService.getThreads().filter(t => t !== id);
    await this.configService.setThreads(list);
    const active = this.configService.getActiveThreadId();
    if (active === id) {
      const next = list[list.length - 1];
      if (next) await this.setActiveThread(next);
    }
  }

  public async resetThread(): Promise<void> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    try {
      this.threadId = await this.createThread(apiKey);
      const list = this.configService.getThreads();
      if (!list.includes(this.threadId)) { list.push(this.threadId); await this.configService.setThreads(list); }
      await this.configService.setActiveThreadId(this.threadId);
      await this.configService.setThreadId(this.threadId);
    } catch (error: any) {
      console.error('Error resetting thread:', error.message);
      throw new Error(`Failed to reset thread: ${error.message}`);
    }
  }

  public async updateAssistantModel(): Promise<void> {
    const apiKey = await this.configService.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not set');
    
    const newModel = this.configService.getModel();
    console.log('updateAssistantModel called - newModel:', newModel);
    
    // Always create a new assistant when model changes
    // This ensures the new model is used
    console.log('Creating new assistant with model:', newModel);
    await this.configService.setAssistantId('');
    this.assistantId = await this.getOrCreateAssistant(apiKey);
    console.log('New assistant created with model:', newModel, 'ID:', this.assistantId);
  }
}
