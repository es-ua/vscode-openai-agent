import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fg from 'fast-glob';

const execAsync = promisify(exec);

// Глобальный объект для хранения запущенных процессов
const runningProcesses = new Map();

// Stream execution function for real-time output
function execStream(command, options = {}) {
  return new Promise((resolve, reject) => {
    // Если есть переменные окружения, добавляем их к команде в виде префикса
    let commandWithEnv = command;
    const envPrefix = [];
    
    if (options.env) {
      // Выводим переменные окружения в терминал для наглядности
      for (const [key, value] of Object.entries(options.env)) {
        // Пропускаем стандартные переменные окружения
        if (key in process.env && process.env[key] === value) continue;
        
        // Добавляем только новые или измененные переменные
        if (key !== 'PATH' && key !== 'Path' && key !== 'path') {
          envPrefix.push(`${key}=${value}`);
        }
      }
      
      // Если есть новые переменные окружения, добавляем их к команде
      if (envPrefix.length > 0) {
        // Для Unix-подобных систем
        if (process.platform !== 'win32') {
          commandWithEnv = `${envPrefix.join(' ')} ${command}`;
        } 
        // Для Windows
        else {
          commandWithEnv = `set ${envPrefix.join(' && set ')} && ${command}`;
        }
      }
    }
    
    // Send terminal command with environment variables
    process.stdout.write(JSON.stringify({
      type: 'terminal_command',
      command: commandWithEnv,
      timestamp: Date.now()
    }) + '\n');

    const proc = spawn(commandWithEnv, [], {
      shell: true,
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Сохраняем процесс в глобальном объекте
    const processId = Date.now().toString();
    runningProcesses.set(command, { proc, processId });

    let stdout = '';
    let stderr = '';
    let isResolved = false;

    // Handle timeout
    const timeout = options.timeout || 300000; // 5 minutes default
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        proc.kill('SIGTERM');
        reject(new Error(`Command timeout after ${timeout}ms`));
      }
    }, timeout);

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      // Send real-time output
      process.stdout.write(JSON.stringify({
        type: 'stream_output',
        command,
        output: output,
        timestamp: Date.now()
      }) + '\n');
      // Also send terminal output
      process.stdout.write(JSON.stringify({
        type: 'terminal_output',
        command,
        output: output,
        type: 'output',
        timestamp: Date.now()
      }) + '\n');
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      // Send real-time error output
      process.stdout.write(JSON.stringify({
        type: 'stream_error',
        command,
        output: output,
        timestamp: Date.now()
      }) + '\n');
      // Also send terminal output
      process.stdout.write(JSON.stringify({
        type: 'terminal_output',
        command,
        output: output,
        type: 'error',
        timestamp: Date.now()
      }) + '\n');
    });

    proc.on('close', (code) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);
        
        // Отправляем сообщение о завершении команды
        const exitMessage = `Command exited with code ${code}`;
        process.stdout.write(JSON.stringify({
          type: 'terminal_output',
          command,
          output: exitMessage,
          isError: code !== 0,
          exitCode: code,
          timestamp: Date.now()
        }) + '\n');
        
        // Отправляем сигнал о завершении команды для анализа
        process.stdout.write(JSON.stringify({
          type: 'terminal_command_end',
          command,
          exitCode: code,
          success: code === 0,
          timestamp: Date.now()
        }) + '\n');
        
        resolve({
          stdout,
          stderr,
          code,
          command
        });
      }
    });

    proc.on('error', (error) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);
        
        // Отправляем сообщение об ошибке выполнения команды
        const errorMessage = `Error executing command: ${error.message}`;
        process.stdout.write(JSON.stringify({
          type: 'terminal_output',
          command,
          output: errorMessage,
          isError: true,
          timestamp: Date.now()
        }) + '\n');
        
        // Отправляем сигнал о завершении команды с ошибкой
        process.stdout.write(JSON.stringify({
          type: 'terminal_command_end',
          command,
          exitCode: -1,
          success: false,
          error: error.message,
          timestamp: Date.now()
        }) + '\n');
        
        reject(error);
      }
    });
  });
}

let nextId = 1;
const pending = new Map();

function send(result, id) {
  const msg = JSON.stringify({ jsonrpc: '2.0', result, id });
  process.stdout.write(msg + '\n');
}

function sendError(error, id) {
  const msg = JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: String(error) }, id });
  process.stdout.write(msg + '\n');
}

function resolvePath(p) {
  const root = process.env.WORKSPACE_DIR || process.cwd();
  if (!p) return root;
  if (path.isAbsolute(p)) return p;
  return path.join(root, p);
}

async function read_file(params) {
  const full = resolvePath(params.path);
  const maxBytes = params.maxBytes ?? 200000;
  const data = await fs.promises.readFile(full);
  const buf = data.slice(0, maxBytes);
  return { path: full, content: buf.toString('utf8'), truncated: data.length > buf.length };
}

async function search_workspace(params) {
  const root = resolvePath(params.root || '.');
  const patterns = params.includeGlobs?.length ? params.includeGlobs : ['**/*.*'];
  const ignore = params.excludeGlobs || ['**/node_modules/**', '**/.git/**', '**/out/**', '**/dist/**'];
  const files = await fg(patterns, { cwd: root, ignore, absolute: true, dot: false });
  const results = [];
  const query = params.query || '';
  const maxMatches = params.maxMatches ?? 200;

  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > (params.maxFileBytes ?? 500000)) continue;
      const text = await fs.promises.readFile(file, 'utf8');
      if (!query || text.includes(query)) {
        results.push({ file, size: stat.size });
        if (results.length >= maxMatches) break;
      }
    } catch {}
  }
  return { root, query, results };
}


async function upsert_file(params) {
  const full = resolvePath(params.path);
  const dir = path.dirname(full);
  await fs.promises.mkdir(dir, { recursive: true });
  const content = params.content ?? '';
  await fs.promises.writeFile(full, content, 'utf8');
  return { path: full, bytes: Buffer.byteLength(content, 'utf8'), status: 'ok' };
}

async function append_file(params) {
  const full = resolvePath(params.path);
  const dir = path.dirname(full);
  await fs.promises.mkdir(dir, { recursive: true });
  const content = params.content ?? '';
  await fs.promises.appendFile(full, content, 'utf8');
  return { path: full, appended: Buffer.byteLength(content, 'utf8'), status: 'ok' };
}

async function make_dir(params) {
  const full = resolvePath(params.path);
  await fs.promises.mkdir(full, { recursive: true });
  return { path: full, status: 'ok' };
}

async function delete_file(params) {
  const full = resolvePath(params.path);
  try {
    await fs.promises.unlink(full);
    return { path: full, status: 'ok' };
  } catch (e) {
    return { path: full, status: 'error', error: String(e) };
  }
}

async function execute_code(params) {
  const { code, language, workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command, args;
    
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'js':
        command = 'node';
        args = ['-e', code];
        break;
      case 'python':
      case 'py':
        command = 'python3';
        args = ['-c', code];
        break;
      case 'typescript':
      case 'ts':
        command = 'npx';
        args = ['ts-node', '-e', code];
        break;
      case 'bash':
      case 'shell':
        command = 'bash';
        args = ['-c', code];
        break;
      case 'powershell':
        command = 'powershell';
        args = ['-Command', code];
        break;
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
    
    const result = await execAsync(command + ' ' + args.join(' '), { 
      cwd: root,
      timeout: 30000, // 30 seconds timeout
      maxBuffer: 1024 * 1024 // 1MB buffer
    });
    
    return {
      language,
      command: command + ' ' + args.join(' '),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      status: 'success'
    };
  } catch (error) {
    return {
      language,
      command: command + ' ' + args.join(' '),
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      status: 'error',
      error: error.message
    };
  }
}

async function run_command(params) {
  const { command, workingDir, timeout = 30000, stream = false, env = {} } = params;
  const root = resolvePath(workingDir || '.');
  
  // Объединяем переменные окружения с текущими
  const mergedEnv = { ...process.env, ...env };
  console.log(`Running command: ${command} in ${root} with env:`, env);
  
  try {
    let result;
    if (stream) {
      // Use streaming execution for long-running commands
      result = await execStream(command, { 
        cwd: root, 
        timeout: timeout || 300000, // 5 minutes default for streaming
        env: mergedEnv
      });
    } else {
      // Use regular execution for quick commands
      result = await execAsync(command, { 
        cwd: root,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
        env: mergedEnv
      });
    }
    
    return {
      command,
      workingDir: root,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code || 0,
      status: 'success'
    };
  } catch (error) {
    return {
      command,
      workingDir: root,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      status: 'error',
      error: error.message
    };
  }
}

async function check_syntax(params) {
  const { filePath, language } = params;
  const full = resolvePath(filePath);
  
  try {
    let command;
    
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'js':
        command = 'node --check';
        break;
      case 'typescript':
      case 'ts':
        command = 'npx tsc --noEmit';
        break;
      case 'python':
      case 'py':
        command = 'python3 -m py_compile';
        break;
      case 'json':
        command = 'node -e "JSON.parse(require(\'fs\').readFileSync(process.argv[1], \'utf8\'))"';
        break;
      default:
        throw new Error(`Unsupported language for syntax check: ${language}`);
    }
    
    const result = await execAsync(`${command} "${full}"`, {
      cwd: path.dirname(full),
      timeout: 10000
    });
    
    return {
      filePath: full,
      language,
      status: 'valid',
      message: 'Syntax is valid'
    };
  } catch (error) {
    return {
      filePath: full,
      language,
      status: 'error',
      message: error.stderr || error.message,
      error: error.message
    };
  }
}

async function install_dependencies(params) {
  const { packageManager = 'npm', workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command;
    
    switch (packageManager.toLowerCase()) {
      case 'npm':
        command = 'npm install';
        break;
      case 'yarn':
        command = 'yarn install';
        break;
      case 'pnpm':
        command = 'pnpm install';
        break;
      case 'pip':
        command = 'pip install -r requirements.txt';
        break;
      case 'pip3':
        command = 'pip3 install -r requirements.txt';
        break;
      default:
        throw new Error(`Unsupported package manager: ${packageManager}`);
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 120000, // 2 minutes timeout for package installation
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    return {
      packageManager,
      workingDir: root,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      packageManager,
      workingDir: root,
      command,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function build_project(params) {
  const { workingDir, buildCommand } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if package.json exists and has build script
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
    
    let command = buildCommand;
    if (!command) {
      if (packageJson.scripts && packageJson.scripts.build) {
        command = 'npm run build';
      } else if (packageJson.scripts && packageJson.scripts.compile) {
        command = 'npm run compile';
      } else {
        // Try TypeScript compilation directly
        command = 'npx tsc -p .';
      }
    }
    
    // Provide instructions for running in VS Code terminal
    const instructions = `Build project detected!\n\nTo build this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following command:\n\n${command}\n\nThis will compile/build your project and you'll see the output in the terminal.`;
    
    return {
      workingDir: root,
      command,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for building in VS Code terminal'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: buildCommand || 'npm run build',
      stdout: `Error analyzing project: ${error.message}\n\nPlease check your project structure and try again.`,
      stderr: '',
      status: 'error',
      error: error.message
    };
  }
}

async function test_project(params) {
  const { workingDir, testCommand } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = testCommand || 'npm test';
    
    // Check if test script exists
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
    
    if (!packageJson.scripts || !packageJson.scripts.test) {
      // Try to run common test frameworks directly
      if (await fs.promises.access(path.join(root, 'test'), fs.constants.F_OK).then(() => true).catch(() => false)) {
        command = 'npx mocha test/**/*.js';
      } else if (await fs.promises.access(path.join(root, 'tests'), fs.constants.F_OK).then(() => true).catch(() => false)) {
        command = 'npx mocha tests/**/*.js';
      } else if (await fs.promises.access(path.join(root, '__tests__'), fs.constants.F_OK).then(() => true).catch(() => false)) {
        command = 'npx jest';
      } else {
        return {
          workingDir: root,
          command: 'npm test',
          stdout: 'No test script found in package.json and no test directories detected\n\nTo run tests:\n1. Open a new terminal in VS Code (Ctrl+Shift+` or Cmd+Shift+`)\n2. Add a test script to package.json or run tests manually',
          stderr: '',
          status: 'skipped',
          message: 'No test configuration found'
        };
      }
    }
    
    // Provide instructions for running in VS Code terminal
    const instructions = `Test project detected!\n\nTo run tests:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following command:\n\n${command}\n\nThis will run your tests and you'll see the results in the terminal.`;
    
    return {
      workingDir: root,
      command,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for running tests in VS Code terminal'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: testCommand || 'npm test',
      stdout: `Error analyzing project: ${error.message}\n\nPlease check your project structure and try again.`,
      stderr: '',
      status: 'error',
      error: error.message
    };
  }
}

async function lint_project(params) {
  const { workingDir, lintCommand } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = lintCommand || 'npm run lint';
    
    // Check if lint script exists
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
    
    if (!packageJson.scripts || !packageJson.scripts.lint) {
      // Try to run eslint directly on common patterns
      command = 'npx eslint "src/**/*.{js,ts}" "lib/**/*.{js,ts}" "*.{js,ts}"';
    }
    
    // Provide instructions for running in VS Code terminal
    const instructions = `Lint project detected!\n\nTo run linting:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following command:\n\n${command}\n\nThis will check your code for issues and you'll see the results in the terminal.`;
    
    return {
      workingDir: root,
      command,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for running linting in VS Code terminal'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: lintCommand || 'npm run lint',
      stdout: `Error analyzing project: ${error.message}\n\nPlease check your project structure and try again.`,
      stderr: '',
      status: 'error',
      error: error.message
    };
  }
}

async function analyze_project(params) {
  const { workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    const analysis = {
      workingDir: root,
      packageJson: null,
      tsconfig: null,
      files: [],
      issues: [],
      recommendations: [],
      projectType: 'unknown',
      containerization: {
        hasDocker: false,
        dockerfiles: [],
        hasDockerCompose: false,
        composeFiles: []
      }
    };
    
    // Analyze package.json
    try {
      const packageJsonPath = path.join(root, 'package.json');
      analysis.packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
      
      // Determine project type
      if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['vscode']) {
        analysis.projectType = 'vscode-extension';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['react-native']) {
        analysis.projectType = 'react-native-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['@ionic/react']) {
        analysis.projectType = 'ionic-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['@ionic/angular']) {
        analysis.projectType = 'ionic-angular-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['cordova']) {
        analysis.projectType = 'cordova-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['expo']) {
        analysis.projectType = 'expo-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['react']) {
        analysis.projectType = 'react-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['express']) {
        analysis.projectType = 'express-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['next']) {
        analysis.projectType = 'nextjs-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['vue']) {
        analysis.projectType = 'vue-app';
      } else if (analysis.packageJson.dependencies && analysis.packageJson.dependencies['angular']) {
        analysis.projectType = 'angular-app';
      } else {
        analysis.projectType = 'nodejs-app';
      }
    } catch (e) {
      // Check if it's a Flutter project (no package.json)
      try {
        const pubspecPath = path.join(root, 'pubspec.yaml');
        await fs.promises.access(pubspecPath, fs.constants.F_OK);
        analysis.projectType = 'flutter-app';
      } catch {
        analysis.issues.push('package.json not found or invalid');
      }
    }
    
    // Analyze tsconfig.json
    try {
      const tsconfigPath = path.join(root, 'tsconfig.json');
      analysis.tsconfig = JSON.parse(await fs.promises.readFile(tsconfigPath, 'utf8'));
    } catch (e) {
      // Not an error, just no TypeScript config
    }
    
    // Check for common files
    const commonFiles = [
      'package.json',
      'README.md',
      'src/index.js',
      'src/index.ts',
      'src/main.js',
      'src/main.ts',
      'index.js',
      'index.ts',
      'app.js',
      'app.ts',
      'server.js',
      'server.ts',
      'App.js',
      'App.tsx',
      'android/app/build.gradle',
      'ios/Podfile',
      'metro.config.js',
      'pubspec.yaml',
      'lib/main.dart',
      'android/app/src/main/AndroidManifest.xml',
      'ios/Runner/Info.plist',
      'config.xml',
      'www/index.html',
      'src/app/app.component.ts',
      'src/app/app.component.html',
      'app.json',
      'expo.json'
    ];
    
    for (const file of commonFiles) {
      try {
        await fs.promises.access(path.join(root, file), fs.constants.F_OK);
        analysis.files.push(file);
      } catch {
        // File doesn't exist, that's ok
      }
    }
    
    // Check for Docker files
    const dockerFiles = [
      'Dockerfile',
      'dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      '.dockerignore'
    ];
    
    // Also check for Dockerfiles in common subdirectories
    const dockerSubdirs = [
      '.',
      'docker',
      '.docker',
      'deploy',
      'deployment',
      'build',
      'infra',
      'infrastructure'
    ];
    
    // Check for Docker files in root and subdirectories
    for (const subdir of dockerSubdirs) {
      const subdirPath = path.join(root, subdir);
      
      // Skip if subdirectory doesn't exist
      try {
        await fs.promises.access(subdirPath, fs.constants.F_OK);
      } catch {
        continue;
      }
      
      // Check for Docker files in this subdirectory
      for (const file of dockerFiles) {
        const filePath = path.join(subdirPath, file);
        try {
          await fs.promises.access(filePath, fs.constants.F_OK);
          const relativePath = path.relative(root, filePath);
          
          // Add to analysis.files
          analysis.files.push(relativePath);
          
          // Add to containerization section
          if (file.toLowerCase() === 'dockerfile') {
            analysis.containerization.hasDocker = true;
            analysis.containerization.dockerfiles.push(relativePath);
          } else if (file.toLowerCase().includes('docker-compose')) {
            analysis.containerization.hasDockerCompose = true;
            analysis.containerization.composeFiles.push(relativePath);
          }
        } catch {
          // File doesn't exist, that's ok
        }
      }
    }
    
    // Also look for any file with "Dockerfile" in the name (like Dockerfile.prod, Dockerfile.dev)
    try {
      const allFiles = await fg(['**/Dockerfile*', '**/dockerfile*'], { cwd: root, ignore: ['**/node_modules/**'] });
      for (const file of allFiles) {
        if (!analysis.containerization.dockerfiles.includes(file)) {
          analysis.containerization.hasDocker = true;
          analysis.containerization.dockerfiles.push(file);
          if (!analysis.files.includes(file)) {
            analysis.files.push(file);
          }
        }
      }
    } catch (e) {
      // Ignore errors in additional file search
    }
    
    // Check for TypeScript compilation if tsconfig exists
    if (analysis.tsconfig) {
      try {
        await execAsync('npx tsc --noEmit', { cwd: root, timeout: 30000 });
      } catch (e) {
        analysis.issues.push('TypeScript compilation errors detected');
      }
    }
    
    // Generate recommendations based on project type
    if (!analysis.files.includes('README.md')) {
      analysis.recommendations.push('Add a README.md file');
    }
    if (analysis.projectType === 'vscode-extension' && !analysis.files.includes('.vscodeignore')) {
      analysis.recommendations.push('Add a .vscodeignore file for VS Code extension');
    }
    if (analysis.projectType === 'react-native-app') {
      if (!analysis.files.includes('android/app/build.gradle')) {
        analysis.recommendations.push('Android project structure not found - run "npx react-native init" to set up');
      }
      if (!analysis.files.includes('ios/Podfile')) {
        analysis.recommendations.push('iOS project structure not found - run "npx react-native init" to set up');
      }
      if (!analysis.files.includes('metro.config.js')) {
        analysis.recommendations.push('Metro bundler config not found - add metro.config.js');
      }
      if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts['start']) {
        analysis.recommendations.push('Add "start" script to package.json for Metro bundler');
      }
      if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts['run-android']) {
        analysis.recommendations.push('Add "run-android" script to package.json');
      }
      if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts['run-ios']) {
        analysis.recommendations.push('Add "run-ios" script to package.json');
      }
    } else if (analysis.projectType === 'flutter-app') {
      if (!analysis.files.includes('lib/main.dart')) {
        analysis.recommendations.push('Main Dart file not found - check lib/main.dart');
      }
      if (!analysis.files.includes('android/app/src/main/AndroidManifest.xml')) {
        analysis.recommendations.push('Android project structure not found - run "flutter create ." to set up');
      }
      if (!analysis.files.includes('ios/Runner/Info.plist')) {
        analysis.recommendations.push('iOS project structure not found - run "flutter create ." to set up');
      }
      analysis.recommendations.push('Use "flutter doctor" to check development environment');
      analysis.recommendations.push('Use "flutter pub get" to install dependencies');
    } else if (analysis.projectType === 'ionic-app' || analysis.projectType === 'ionic-angular-app') {
      if (!analysis.files.includes('src/app/app.component.ts')) {
        analysis.recommendations.push('Ionic app component not found - check src/app/app.component.ts');
      }
      if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts['build']) {
        analysis.recommendations.push('Add "build" script to package.json');
      }
      if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts['serve']) {
        analysis.recommendations.push('Add "serve" script to package.json for development server');
      }
      analysis.recommendations.push('Use "ionic capacitor add" to add mobile platforms');
    } else if (analysis.projectType === 'cordova-app') {
      if (!analysis.files.includes('config.xml')) {
        analysis.recommendations.push('Cordova config.xml not found');
      }
      if (!analysis.files.includes('www/index.html')) {
        analysis.recommendations.push('Cordova www/index.html not found');
      }
      analysis.recommendations.push('Use "cordova platform add" to add mobile platforms');
      analysis.recommendations.push('Use "cordova build" to build the app');
    } else if (analysis.projectType === 'expo-app') {
      if (!analysis.files.includes('app.json') && !analysis.files.includes('expo.json')) {
        analysis.recommendations.push('Expo configuration not found - add app.json or expo.json');
      }
      if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts['start']) {
        analysis.recommendations.push('Add "start" script to package.json for Expo development server');
      }
      analysis.recommendations.push('Use "expo start" to start development server');
      analysis.recommendations.push('Use "expo build" to build the app');
    }
    if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts.test) {
      analysis.recommendations.push('Add test scripts to package.json');
    }
    if (!analysis.packageJson || !analysis.packageJson.scripts || !analysis.packageJson.scripts.lint) {
      analysis.recommendations.push('Add lint scripts to package.json');
    }
    
    // Docker-related recommendations
    if (analysis.containerization.hasDocker) {
      analysis.recommendations.push(`Docker detected: ${analysis.containerization.dockerfiles.join(', ')}`);
      
      if (!analysis.containerization.hasDockerCompose && analysis.containerization.dockerfiles.length > 0) {
        analysis.recommendations.push('Consider adding docker-compose.yml for easier container orchestration');
      }
      
      if (!analysis.files.includes('.dockerignore')) {
        analysis.recommendations.push('Add .dockerignore file to exclude unnecessary files from Docker builds');
      }
      
      // Add Docker-related commands to package.json if they don't exist
      if (analysis.packageJson && analysis.packageJson.scripts) {
        const scripts = analysis.packageJson.scripts;
        if (!scripts['docker:build'] && !scripts['docker-build']) {
          analysis.recommendations.push('Add "docker:build" script to package.json for building Docker image');
        }
        if (!scripts['docker:run'] && !scripts['docker-run']) {
          analysis.recommendations.push('Add "docker:run" script to package.json for running Docker container');
        }
      }
    }
    
    return {
      ...analysis,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message
    };
  }
}

async function run_react_native(params) {
  const { workingDir, platform, device } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command;
    
    if (platform === 'android') {
      command = 'npx react-native run-android';
      if (device) {
        command += ` --deviceId=${device}`;
      }
    } else if (platform === 'ios') {
      command = 'npx react-native run-ios';
      if (device) {
        command += ` --device="${device}"`;
      }
    } else {
      throw new Error('Platform must be "android" or "ios"');
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 300000, // 5 minutes timeout for React Native builds
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer for build output
    });
    
    return {
      workingDir: root,
      platform,
      device,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      platform,
      device,
      command: `npx react-native run-${platform}`,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function start_metro(params) {
  const { workingDir, port } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = 'npx react-native start';
    if (port) {
      command += ` --port=${port}`;
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 60000, // 1 minute timeout for Metro startup
      maxBuffer: 1024 * 1024 * 5 // 5MB buffer
    });
    
    return {
      workingDir: root,
      port: port || 8081,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      port: port || 8081,
      command: 'npx react-native start',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function install_pods(params) {
  const { workingDir } = params;
  const root = resolvePath(workingDir || '.');
  const iosPath = path.join(root, 'ios');
  
  try {
    // Check if iOS directory exists
    try {
      await fs.promises.access(iosPath, fs.constants.F_OK);
    } catch {
      return {
        workingDir: root,
        command: 'cd ios && pod install',
        stdout: 'iOS directory not found',
        stderr: '',
        status: 'skipped',
        message: 'No iOS project found'
      };
    }
    
    const result = await execAsync('cd ios && pod install', {
      cwd: root,
      timeout: 300000, // 5 minutes timeout for pod install
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });
    
    return {
      workingDir: root,
      command: 'cd ios && pod install',
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: 'cd ios && pod install',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function clean_react_native(params) {
  const { workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    const commands = [
      'npx react-native clean',
      'rm -rf node_modules',
      'npm install',
      'cd ios && pod install && cd ..'
    ];
    
    let allOutput = '';
    let allErrors = '';
    
    for (const cmd of commands) {
      try {
        const result = await execAsync(cmd, {
          cwd: root,
          timeout: 120000, // 2 minutes per command
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        allOutput += `\n=== ${cmd} ===\n${result.stdout}`;
        if (result.stderr) allErrors += `\n=== ${cmd} ===\n${result.stderr}`;
      } catch (e) {
        allErrors += `\n=== ${cmd} ===\n${e.message}`;
      }
    }
    
    return {
      workingDir: root,
      commands,
      stdout: allOutput,
      stderr: allErrors,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      commands: ['npx react-native clean', 'rm -rf node_modules', 'npm install'],
      stdout: '',
      stderr: error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function run_flutter(params) {
  const { workingDir, platform, device } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = 'flutter run';
    
    if (platform === 'android') {
      command += ' -d android';
    } else if (platform === 'ios') {
      command += ' -d ios';
    } else if (platform === 'web') {
      command += ' -d web-server';
    }
    
    if (device) {
      command += ` -d ${device}`;
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 300000, // 5 minutes timeout for Flutter builds
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });
    
    return {
      workingDir: root,
      platform,
      device,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      platform,
      device,
      command: 'flutter run',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function flutter_doctor(params) {
  const { workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    const result = await execAsync('flutter doctor -v', {
      cwd: root,
      timeout: 60000, // 1 minute timeout
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    return {
      workingDir: root,
      command: 'flutter doctor -v',
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: 'flutter doctor -v',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function flutter_pub_get(params) {
  const { workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    const result = await execAsync('flutter pub get', {
      cwd: root,
      timeout: 120000, // 2 minutes timeout
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    return {
      workingDir: root,
      command: 'flutter pub get',
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: 'flutter pub get',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function run_ionic(params) {
  const { workingDir, platform, command: ionicCommand } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = ionicCommand || 'ionic serve';
    
    if (platform === 'android') {
      command = 'ionic capacitor run android';
    } else if (platform === 'ios') {
      command = 'ionic capacitor run ios';
    } else if (platform === 'build') {
      command = 'ionic build';
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 300000, // 5 minutes timeout
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });
    
    return {
      workingDir: root,
      platform,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      platform,
      command: ionicCommand || 'ionic serve',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function run_cordova(params) {
  const { workingDir, platform, command: cordovaCommand } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = cordovaCommand || 'cordova build';
    
    if (platform === 'android') {
      command = 'cordova build android';
    } else if (platform === 'ios') {
      command = 'cordova build ios';
    } else if (platform === 'run-android') {
      command = 'cordova run android';
    } else if (platform === 'run-ios') {
      command = 'cordova run ios';
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 300000, // 5 minutes timeout
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });
    
    return {
      workingDir: root,
      platform,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      platform,
      command: cordovaCommand || 'cordova build',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function run_expo(params) {
  const { workingDir, command: expoCommand } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command = expoCommand || 'expo start';
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 300000, // 5 minutes timeout
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });
    
    return {
      workingDir: root,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: expoCommand || 'expo start',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function list_devices(params) {
  const { workingDir, platform } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    let command;
    
    if (platform === 'android') {
      command = 'adb devices';
    } else if (platform === 'ios') {
      command = 'xcrun simctl list devices';
    } else if (platform === 'flutter') {
      command = 'flutter devices';
    } else {
      // Try all platforms
      const results = {};
      
      try {
        const androidResult = await execAsync('adb devices', { cwd: root, timeout: 10000 });
        results.android = androidResult.stdout;
      } catch (e) {
        results.android = 'Android devices not available';
      }
      
      try {
        const iosResult = await execAsync('xcrun simctl list devices', { cwd: root, timeout: 10000 });
        results.ios = iosResult.stdout;
      } catch (e) {
        results.ios = 'iOS devices not available';
      }
      
      try {
        const flutterResult = await execAsync('flutter devices', { cwd: root, timeout: 10000 });
        results.flutter = flutterResult.stdout;
      } catch (e) {
        results.flutter = 'Flutter devices not available';
      }
      
      return {
        workingDir: root,
        command: 'list all devices',
        stdout: JSON.stringify(results, null, 2),
        stderr: '',
        status: 'success'
      };
    }
    
    const result = await execAsync(command, {
      cwd: root,
      timeout: 30000, // 30 seconds timeout
      maxBuffer: 1024 * 1024 * 5 // 5MB buffer
    });
    
    return {
      workingDir: root,
      platform,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      status: 'success'
    };
  } catch (error) {
    return {
      workingDir: root,
      platform,
      command: 'list devices',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function run_vscode_extension(params) {
  const { workingDir } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if this is a VS Code extension project
    const packageJsonPath = path.join(root, 'package.json');
    let isVSCodeExtension = false;
    let packageJson = null;
    
    try {
      packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
      isVSCodeExtension = packageJson.engines && packageJson.engines.vscode;
    } catch (e) {
      // Not a valid package.json
    }
    
    if (!isVSCodeExtension) {
      return {
        workingDir: root,
        command: 'VS Code extension launch',
        stdout: 'This is not a VS Code extension project',
        stderr: '',
        status: 'skipped',
        message: 'Not a VS Code extension'
      };
    }
    
    // For VS Code extensions, we'll provide instructions to run in terminal
    let instructions = `VS Code Extension detected!\n\nTo run this extension in development mode:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following commands:\n\n`;
    
    if (packageJson && packageJson.scripts && packageJson.scripts.compile) {
      instructions += `npm run compile\n`;
    }
    
    instructions += `code --extensionDevelopmentPath="${root}"\n\n`;
    instructions += `Or simply press F5 in VS Code to run the extension in development mode.`;
    
    return {
      workingDir: root,
      command: 'VS Code extension launch instructions',
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for manual launch'
    };
  } catch (error) {
    return {
      workingDir: root,
      command: 'VS Code extension launch',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function stop_command(params) {
  const { command } = params;
  
  try {
    console.log(`Attempting to stop command: ${command}`);
    
    // Находим процесс по команде
    const processInfo = runningProcesses.get(command);
    if (!processInfo) {
      return {
        command,
        status: 'not_found',
        message: 'Command process not found'
      };
    }
    
    // Останавливаем процесс
    const { proc, processId } = processInfo;
    
    // Отправляем сигнал SIGTERM
    proc.kill('SIGTERM');
    
    // Отправляем сообщение о остановке команды
    process.stdout.write(JSON.stringify({
      type: 'terminal_command_end',
      command,
      exitCode: -1,
      success: false,
      error: 'Command was stopped by user',
      timestamp: Date.now()
    }) + '\n');
    
    // Удаляем процесс из списка запущенных
    runningProcesses.delete(command);
    
    return {
      command,
      status: 'stopped',
      message: 'Command was stopped successfully'
    };
  } catch (error) {
    console.error(`Error stopping command: ${error.message}`);
    return {
      command,
      status: 'error',
      error: error.message
    };
  }
}

async function test_mcp(params) {
  return {
    status: 'success',
    message: 'MCP server is working',
    timestamp: new Date().toISOString()
  };
}

async function run_project(params) {
  const { workingDir, stream = false } = params;
  const root = resolvePath(workingDir || '.');
  
  console.log('run_project called with:', { workingDir, stream, root });
  
  try {
    // Analyze project type and determine how to run it
    const packageJsonPath = path.join(root, 'package.json');
    let projectType = 'unknown';
    let runCommand = '';
    let instructions = '';
    
    try {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
      
      // Determine project type based on dependencies and scripts
      if (packageJson.engines && packageJson.engines.vscode) {
        projectType = 'vscode-extension';
        // Provide instructions for VS Code extension
        instructions = `VS Code Extension detected!\n\nTo run this extension in development mode:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following commands:\n\n`;
        
        if (packageJson.scripts && packageJson.scripts.compile) {
          instructions += `npm run compile\n`;
        }
        
        instructions += `code --extensionDevelopmentPath="${root}"\n\n`;
        instructions += `Or simply press F5 in VS Code to run the extension in development mode.`;
        
        runCommand = `echo "${instructions}"`;
      } else if (packageJson.dependencies && packageJson.dependencies['react-native']) {
        projectType = 'react-native';
        runCommand = 'npx react-native start';
        instructions = `React Native project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}\n3. In another terminal, run: npx react-native run-android (or run-ios)`;
      } else if (packageJson.dependencies && packageJson.dependencies['@ionic/react']) {
        projectType = 'ionic-react';
        runCommand = 'ionic serve';
        instructions = `Ionic React project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['@ionic/angular']) {
        projectType = 'ionic-angular';
        runCommand = 'ionic serve';
        instructions = `Ionic Angular project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['expo']) {
        projectType = 'expo';
        runCommand = 'expo start';
        instructions = `Expo project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['next']) {
        projectType = 'nextjs';
        runCommand = 'npm run dev';
        instructions = `Next.js project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['react']) {
        projectType = 'react';
        runCommand = 'npm start';
        instructions = `React project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['vue']) {
        projectType = 'vue';
        runCommand = 'npm run serve';
        instructions = `Vue project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['angular']) {
        projectType = 'angular';
        runCommand = 'ng serve';
        instructions = `Angular project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.dependencies && packageJson.dependencies['express']) {
        projectType = 'express';
        runCommand = 'npm start';
        instructions = `Express project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.scripts && packageJson.scripts.start) {
        projectType = 'nodejs';
        runCommand = 'npm start';
        instructions = `Node.js project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.scripts && packageJson.scripts.dev) {
        projectType = 'nodejs';
        runCommand = 'npm run dev';
        instructions = `Node.js project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.scripts && packageJson.scripts.serve) {
        projectType = 'nodejs';
        runCommand = 'npm run serve';
        instructions = `Node.js project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (packageJson.scripts && packageJson.scripts.compile) {
        projectType = 'vscode-extension';
        runCommand = 'npm run compile';
        instructions = `VS Code Extension detected!\n\nTo run this extension:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}\n3. Then press F5 in VS Code to run in development mode`;
      } else if (packageJson.scripts && packageJson.scripts['vscode:prepublish']) {
        projectType = 'vscode-extension';
        runCommand = 'npm run vscode:prepublish';
        instructions = `VS Code Extension detected!\n\nTo run this extension:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}\n3. Then press F5 in VS Code to run in development mode`;
      } else {
        // Check for other common files
        const files = await fs.promises.readdir(root);
        if (files.includes('pubspec.yaml')) {
          projectType = 'flutter';
          runCommand = 'flutter run';
          instructions = `Flutter project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else if (files.includes('config.xml')) {
          projectType = 'cordova';
          runCommand = 'cordova serve';
          instructions = `Cordova project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else if (files.includes('Cargo.toml')) {
          projectType = 'rust';
          runCommand = 'cargo run';
          instructions = `Rust project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else if (files.includes('requirements.txt')) {
          projectType = 'python';
          runCommand = 'python main.py';
          instructions = `Python project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else if (files.includes('main.py')) {
          projectType = 'python';
          runCommand = 'python main.py';
          instructions = `Python project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else if (files.includes('app.py')) {
          projectType = 'python';
          runCommand = 'python app.py';
          instructions = `Python project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else if (files.includes('index.html')) {
          projectType = 'html';
          runCommand = 'python -m http.server 8000';
          instructions = `HTML project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
        } else {
          projectType = 'unknown';
          runCommand = 'echo "No run command found for this project type"';
          instructions = `Unknown project type.\n\nPlease check the project structure and run appropriate commands manually in the terminal.`;
        }
      }
    } catch (e) {
      // No package.json, try to detect by files
      const files = await fs.promises.readdir(root);
      if (files.includes('pubspec.yaml')) {
        projectType = 'flutter';
        runCommand = 'flutter run';
        instructions = `Flutter project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (files.includes('Cargo.toml')) {
        projectType = 'rust';
        runCommand = 'cargo run';
        instructions = `Rust project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (files.includes('main.py')) {
        projectType = 'python';
        runCommand = 'python main.py';
        instructions = `Python project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else if (files.includes('index.html')) {
        projectType = 'html';
        runCommand = 'python -m http.server 8000';
        instructions = `HTML project detected!\n\nTo run this project:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run: ${runCommand}`;
      } else {
        projectType = 'unknown';
        runCommand = 'echo "No run command found for this project type"';
        instructions = `Unknown project type.\n\nPlease check the project structure and run appropriate commands manually in the terminal.`;
      }
    }
    
    // Return instructions instead of executing commands
    const result = {
      workingDir: root,
      projectType,
      command: runCommand,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for running in VS Code terminal'
    };
    
    console.log('run_project returning:', result);
    return result;
  } catch (error) {
    console.error('run_project error:', error);
    return {
      workingDir: root,
      projectType: 'unknown',
      command: 'run project',
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: 'error',
      error: error.message
    };
  }
}

async function docker_build(params) {
  const { workingDir, dockerfile = 'Dockerfile', tag, buildArgs = {} } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if Docker is installed
    try {
      await execAsync('docker --version', { timeout: 5000 });
    } catch (e) {
      return {
        workingDir: root,
        status: 'error',
        error: 'Docker is not installed or not in PATH',
        stdout: '',
        stderr: 'Docker command not found. Please install Docker first.'
      };
    }
    
    // Check if Dockerfile exists
    const dockerfilePath = path.join(root, dockerfile);
    try {
      await fs.promises.access(dockerfilePath, fs.constants.F_OK);
    } catch (e) {
      return {
        workingDir: root,
        status: 'error',
        error: `Dockerfile not found: ${dockerfile}`,
        stdout: '',
        stderr: `Dockerfile not found at ${dockerfilePath}`
      };
    }
    
    // Construct the build command
    let command = `docker build -f ${dockerfile}`;
    
    // Add tag if provided
    if (tag) {
      command += ` -t ${tag}`;
    }
    
    // Add build args if provided
    if (buildArgs && Object.keys(buildArgs).length > 0) {
      for (const [key, value] of Object.entries(buildArgs)) {
        command += ` --build-arg ${key}=${value}`;
      }
    }
    
    // Add the build context
    command += ' .';
    
    // Provide instructions for running in VS Code terminal
    const instructions = `Docker build detected!\n\nTo build this Docker image:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following command:\n\n${command}\n\nThis will build your Docker image and you'll see the output in the terminal.`;
    
    return {
      workingDir: root,
      command,
      dockerfile,
      tag: tag || 'latest',
      buildArgs,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for building Docker image in VS Code terminal'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message,
      stdout: '',
      stderr: error.message
    };
  }
}

async function docker_run(params) {
  const { workingDir, image, tag = 'latest', ports = [], env = {}, volumes = [], command } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if Docker is installed
    try {
      await execAsync('docker --version', { timeout: 5000 });
    } catch (e) {
      return {
        workingDir: root,
        status: 'error',
        error: 'Docker is not installed or not in PATH',
        stdout: '',
        stderr: 'Docker command not found. Please install Docker first.'
      };
    }
    
    // Construct the run command
    let runCommand = `docker run`;
    
    // Add ports if provided
    if (ports && ports.length > 0) {
      for (const port of ports) {
        runCommand += ` -p ${port}`;
      }
    }
    
    // Add environment variables if provided
    if (env && Object.keys(env).length > 0) {
      for (const [key, value] of Object.entries(env)) {
        runCommand += ` -e ${key}=${value}`;
      }
    }
    
    // Add volumes if provided
    if (volumes && volumes.length > 0) {
      for (const volume of volumes) {
        runCommand += ` -v ${volume}`;
      }
    }
    
    // Add image name and tag
    runCommand += ` ${image}:${tag}`;
    
    // Add command if provided
    if (command) {
      runCommand += ` ${command}`;
    }
    
    // Provide instructions for running in VS Code terminal
    const instructions = `Docker run detected!\n\nTo run this Docker container:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following command:\n\n${runCommand}\n\nThis will run your Docker container and you'll see the output in the terminal.`;
    
    return {
      workingDir: root,
      command: runCommand,
      image,
      tag,
      ports,
      env,
      volumes,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for running Docker container in VS Code terminal'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message,
      stdout: '',
      stderr: error.message
    };
  }
}

async function docker_compose(params) {
  const { workingDir, command = 'up', file = 'docker-compose.yml', service, options = [] } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if Docker Compose is installed
    try {
      await execAsync('docker-compose --version', { timeout: 5000 });
    } catch (e) {
      return {
        workingDir: root,
        status: 'error',
        error: 'Docker Compose is not installed or not in PATH',
        stdout: '',
        stderr: 'Docker Compose command not found. Please install Docker Compose first.'
      };
    }
    
    // Check if docker-compose.yml exists
    const composePath = path.join(root, file);
    try {
      await fs.promises.access(composePath, fs.constants.F_OK);
    } catch (e) {
      return {
        workingDir: root,
        status: 'error',
        error: `Docker Compose file not found: ${file}`,
        stdout: '',
        stderr: `Docker Compose file not found at ${composePath}`
      };
    }
    
    // Construct the docker-compose command
    let composeCommand = `docker-compose -f ${file} ${command}`;
    
    // Add options if provided
    if (options && options.length > 0) {
      composeCommand += ` ${options.join(' ')}`;
    }
    
    // Add service if provided
    if (service) {
      composeCommand += ` ${service}`;
    }
    
    // Provide instructions for running in VS Code terminal
    const instructions = `Docker Compose detected!\n\nTo run Docker Compose:\n\n1. Open a new terminal in VS Code (Ctrl+Shift+\` or Cmd+Shift+\`)\n2. Run the following command:\n\n${composeCommand}\n\nThis will ${command} your Docker Compose services and you'll see the output in the terminal.`;
    
    return {
      workingDir: root,
      command: composeCommand,
      file,
      dockerCommand: command,
      service,
      options,
      stdout: instructions,
      stderr: '',
      status: 'success',
      message: 'Instructions provided for running Docker Compose in VS Code terminal'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message,
      stdout: '',
      stderr: error.message
    };
  }
}

async function create_dockerignore(params) {
  const { workingDir, template = 'standard' } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if .dockerignore already exists
    const dockerignorePath = path.join(root, '.dockerignore');
    try {
      await fs.promises.access(dockerignorePath, fs.constants.F_OK);
      return {
        workingDir: root,
        status: 'error',
        error: '.dockerignore already exists',
        stdout: '',
        stderr: '.dockerignore already exists at ' + dockerignorePath
      };
    } catch (e) {
      // File doesn't exist, that's good
    }
    
    let dockerignoreContent = '';
    
    // Use predefined templates
    switch (template.toLowerCase()) {
      case 'node':
        dockerignoreContent = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Dependency directories
node_modules/
jspm_packages/

# TypeScript cache
*.tsbuildinfo

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# dotenv environment variable files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Build directories
dist
build
out
`;
        break;
      case 'python':
        dockerignoreContent = `# Byte-compiled / optimized / DLL files
__pycache__/
*.py[cod]
*$py.class

# C extensions
*.so

# Distribution / packaging
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Unit test / coverage reports
htmlcov/
.tox/
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
.hypothesis/

# Translations
*.mo
*.pot

# Django stuff:
*.log
local_settings.py
db.sqlite3

# Flask stuff:
instance/
.webassets-cache

# Environments
.env
.venv
env/
venv/
ENV/
env.bak/
venv.bak/

# mypy
.mypy_cache/

# pytest
.pytest_cache/

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;
        break;
      case 'go':
        dockerignoreContent = `# Binaries for programs and plugins
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary, built with 'go test -c'
*.test

# Output of the go coverage tool
*.out

# Dependency directories
vendor/

# Go workspace file
go.work

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;
        break;
      case 'minimal':
        dockerignoreContent = `# Git
.git
.gitignore

# Docker
.docker

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment variables
.env
.env.*
`;
        break;
      case 'standard':
      default:
        dockerignoreContent = `# Git
.git
.gitignore
.github

# Docker
.docker
docker-compose*.yml

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment variables
.env
.env.*

# Logs
logs
*.log

# OS generated files
.DS_Store
Thumbs.db

# Build and temp directories
dist
build
out
tmp
temp
`;
        break;
    }
    
    // Write the .dockerignore file
    await fs.promises.writeFile(dockerignorePath, dockerignoreContent, 'utf8');
    
    return {
      workingDir: root,
      filePath: '.dockerignore',
      content: dockerignoreContent,
      stdout: `Docker ignore file created at ${dockerignorePath}`,
      stderr: '',
      status: 'success',
      message: '.dockerignore created successfully'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message,
      stdout: '',
      stderr: error.message
    };
  }
}

async function create_docker_compose(params) {
  const { workingDir, services = [], networks = [], volumes = [] } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if docker-compose.yml already exists
    const composeFilePath = path.join(root, 'docker-compose.yml');
    try {
      await fs.promises.access(composeFilePath, fs.constants.F_OK);
      return {
        workingDir: root,
        status: 'error',
        error: 'docker-compose.yml already exists',
        stdout: '',
        stderr: 'docker-compose.yml already exists at ' + composeFilePath
      };
    } catch (e) {
      // File doesn't exist, that's good
    }
    
    // Create a basic docker-compose.yml template
    let composeContent = 'version: "3.8"\n\n';
    
    // Add services
    composeContent += 'services:\n';
    
    if (services && services.length > 0) {
      for (const service of services) {
        composeContent += `  ${service.name}:\n`;
        
        if (service.image) {
          composeContent += `    image: ${service.image}\n`;
        } else if (service.build) {
          composeContent += '    build:\n';
          if (typeof service.build === 'string') {
            composeContent += `      context: ${service.build}\n`;
          } else {
            if (service.build.context) {
              composeContent += `      context: ${service.build.context}\n`;
            }
            if (service.build.dockerfile) {
              composeContent += `      dockerfile: ${service.build.dockerfile}\n`;
            }
          }
        }
        
        if (service.ports && service.ports.length > 0) {
          composeContent += '    ports:\n';
          for (const port of service.ports) {
            composeContent += `      - "${port}"\n`;
          }
        }
        
        if (service.environment && Object.keys(service.environment).length > 0) {
          composeContent += '    environment:\n';
          for (const [key, value] of Object.entries(service.environment)) {
            composeContent += `      - ${key}=${value}\n`;
          }
        }
        
        if (service.volumes && service.volumes.length > 0) {
          composeContent += '    volumes:\n';
          for (const volume of service.volumes) {
            composeContent += `      - ${volume}\n`;
          }
        }
        
        if (service.depends_on && service.depends_on.length > 0) {
          composeContent += '    depends_on:\n';
          for (const dependency of service.depends_on) {
            composeContent += `      - ${dependency}\n`;
          }
        }
        
        if (service.networks && service.networks.length > 0) {
          composeContent += '    networks:\n';
          for (const network of service.networks) {
            composeContent += `      - ${network}\n`;
          }
        }
        
        if (service.restart) {
          composeContent += `    restart: ${service.restart}\n`;
        }
        
        if (service.command) {
          composeContent += `    command: ${service.command}\n`;
        }
        
        composeContent += '\n';
      }
    } else {
      // Add a default app service if none provided
      composeContent += `  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
    volumes:
      - .:/app
      - /app/node_modules
    restart: unless-stopped

`;
    }
    
    // Add networks
    if (networks && networks.length > 0) {
      composeContent += '\nnetworks:\n';
      for (const network of networks) {
        composeContent += `  ${network}:\n`;
        composeContent += '    driver: bridge\n';
      }
    }
    
    // Add volumes
    if (volumes && volumes.length > 0) {
      composeContent += '\nvolumes:\n';
      for (const volume of volumes) {
        composeContent += `  ${volume}:\n`;
        composeContent += '    driver: local\n';
      }
    }
    
    // Write the docker-compose.yml file
    await fs.promises.writeFile(composeFilePath, composeContent, 'utf8');
    
    return {
      workingDir: root,
      filePath: 'docker-compose.yml',
      content: composeContent,
      stdout: `Docker Compose file created at ${composeFilePath}`,
      stderr: '',
      status: 'success',
      message: 'Docker Compose file created successfully'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message,
      stdout: '',
      stderr: error.message
    };
  }
}

async function create_dockerfile(params) {
  const { workingDir, template = 'node', baseImage, ports = [], workdir, env = {}, commands = [] } = params;
  const root = resolvePath(workingDir || '.');
  
  try {
    // Check if Dockerfile already exists
    const dockerfilePath = path.join(root, 'Dockerfile');
    try {
      await fs.promises.access(dockerfilePath, fs.constants.F_OK);
      return {
        workingDir: root,
        status: 'error',
        error: 'Dockerfile already exists',
        stdout: '',
        stderr: 'Dockerfile already exists at ' + dockerfilePath
      };
    } catch (e) {
      // File doesn't exist, that's good
    }
    
    let dockerfileContent = '';
    
    // Use template or custom base image
    if (baseImage) {
      dockerfileContent += `FROM ${baseImage}\n\n`;
    } else {
      // Use predefined templates
      switch (template.toLowerCase()) {
        case 'node':
          dockerfileContent += `FROM node:18-alpine\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY package*.json ./\n\n`;
          dockerfileContent += `RUN npm install\n\n`;
          dockerfileContent += `COPY . .\n\n`;
          dockerfileContent += `EXPOSE 3000\n\n`;
          dockerfileContent += `CMD ["npm", "start"]\n`;
          break;
        case 'python':
          dockerfileContent += `FROM python:3.10-slim\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY requirements.txt .\n\n`;
          dockerfileContent += `RUN pip install --no-cache-dir -r requirements.txt\n\n`;
          dockerfileContent += `COPY . .\n\n`;
          dockerfileContent += `EXPOSE 5000\n\n`;
          dockerfileContent += `CMD ["python", "app.py"]\n`;
          break;
        case 'go':
          dockerfileContent += `FROM golang:1.19-alpine AS builder\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY go.* .\n`;
          dockerfileContent += `RUN go mod download\n\n`;
          dockerfileContent += `COPY . .\n\n`;
          dockerfileContent += `RUN CGO_ENABLED=0 GOOS=linux go build -o /app/main .\n\n`;
          dockerfileContent += `FROM alpine:latest\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY --from=builder /app/main .\n\n`;
          dockerfileContent += `EXPOSE 8080\n\n`;
          dockerfileContent += `CMD ["./main"]\n`;
          break;
        case 'java':
          dockerfileContent += `FROM maven:3.8-openjdk-17 AS builder\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY pom.xml .\n`;
          dockerfileContent += `RUN mvn dependency:go-offline\n\n`;
          dockerfileContent += `COPY src ./src\n\n`;
          dockerfileContent += `RUN mvn package -DskipTests\n\n`;
          dockerfileContent += `FROM openjdk:17-slim\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY --from=builder /app/target/*.jar app.jar\n\n`;
          dockerfileContent += `EXPOSE 8080\n\n`;
          dockerfileContent += `CMD ["java", "-jar", "app.jar"]\n`;
          break;
        case 'rust':
          dockerfileContent += `FROM rust:1.68 as builder\n\n`;
          dockerfileContent += `WORKDIR /usr/src/app\n\n`;
          dockerfileContent += `COPY Cargo.toml Cargo.lock ./\n\n`;
          dockerfileContent += `# Create a dummy main.rs to build dependencies\n`;
          dockerfileContent += `RUN mkdir -p src && echo "fn main() {}" > src/main.rs\n`;
          dockerfileContent += `RUN cargo build --release\n\n`;
          dockerfileContent += `# Now copy the real source code and build again\n`;
          dockerfileContent += `COPY src ./src\n`;
          dockerfileContent += `RUN touch src/main.rs && cargo build --release\n\n`;
          dockerfileContent += `FROM debian:bullseye-slim\n\n`;
          dockerfileContent += `COPY --from=builder /usr/src/app/target/release/app /usr/local/bin/app\n\n`;
          dockerfileContent += `EXPOSE 8000\n\n`;
          dockerfileContent += `CMD ["app"]\n`;
          break;
        case 'php':
          dockerfileContent += `FROM php:8.1-apache\n\n`;
          dockerfileContent += `WORKDIR /var/www/html\n\n`;
          dockerfileContent += `COPY . .\n\n`;
          dockerfileContent += `RUN apt-get update && apt-get install -y \\\n`;
          dockerfileContent += `    libzip-dev \\\n`;
          dockerfileContent += `    && docker-php-ext-install zip pdo pdo_mysql\n\n`;
          dockerfileContent += `EXPOSE 80\n\n`;
          dockerfileContent += `CMD ["apache2-foreground"]\n`;
          break;
        case 'nginx':
          dockerfileContent += `FROM nginx:alpine\n\n`;
          dockerfileContent += `COPY . /usr/share/nginx/html\n\n`;
          dockerfileContent += `EXPOSE 80\n\n`;
          dockerfileContent += `CMD ["nginx", "-g", "daemon off;"]\n`;
          break;
        case 'minimal':
        default:
          dockerfileContent += `FROM alpine:latest\n\n`;
          dockerfileContent += `WORKDIR /app\n\n`;
          dockerfileContent += `COPY . .\n\n`;
          dockerfileContent += `CMD ["sh"]\n`;
          break;
      }
    }
    
    // If custom parameters are provided, override the template
    if (workdir) {
      // Replace WORKDIR line if it exists
      if (dockerfileContent.includes('WORKDIR ')) {
        dockerfileContent = dockerfileContent.replace(/WORKDIR .*\n/, `WORKDIR ${workdir}\n`);
      } else {
        // Add WORKDIR line if it doesn't exist
        dockerfileContent = dockerfileContent.replace(/FROM .*\n\n/, `FROM ${baseImage || 'alpine:latest'}\n\nWORKDIR ${workdir}\n\n`);
      }
    }
    
    // Add custom ports if provided
    if (ports && ports.length > 0) {
      // Remove existing EXPOSE lines
      dockerfileContent = dockerfileContent.replace(/EXPOSE .*\n\n/g, '');
      
      // Add new EXPOSE lines
      let exposeLines = '';
      for (const port of ports) {
        exposeLines += `EXPOSE ${port}\n`;
      }
      exposeLines += '\n';
      
      // Add before CMD line
      dockerfileContent = dockerfileContent.replace(/CMD /, exposeLines + 'CMD ');
    }
    
    // Add environment variables if provided
    if (env && Object.keys(env).length > 0) {
      let envLines = '';
      for (const [key, value] of Object.entries(env)) {
        envLines += `ENV ${key}=${value}\n`;
      }
      envLines += '\n';
      
      // Add before CMD line
      dockerfileContent = dockerfileContent.replace(/CMD /, envLines + 'CMD ');
    }
    
    // Add custom commands if provided
    if (commands && commands.length > 0) {
      let commandLines = '';
      for (const command of commands) {
        commandLines += `RUN ${command}\n`;
      }
      commandLines += '\n';
      
      // Add before CMD line
      dockerfileContent = dockerfileContent.replace(/CMD /, commandLines + 'CMD ');
    }
    
    // Write the Dockerfile
    await fs.promises.writeFile(dockerfilePath, dockerfileContent, 'utf8');
    
    return {
      workingDir: root,
      filePath: 'Dockerfile',
      content: dockerfileContent,
      stdout: `Dockerfile created at ${dockerfilePath}`,
      stderr: '',
      status: 'success',
      message: 'Dockerfile created successfully'
    };
  } catch (error) {
    return {
      workingDir: root,
      status: 'error',
      error: error.message,
      stdout: '',
      stderr: error.message
    };
  }
}

const handlers = { 
  read_file, 
  search_workspace, 
  upsert_file, 
  append_file, 
  make_dir, 
  delete_file,
  execute_code,
  run_command,
  check_syntax,
  install_dependencies,
  build_project,
  test_project,
  lint_project,
  analyze_project,
  run_react_native,
  start_metro,
  install_pods,
  clean_react_native,
  run_flutter,
  flutter_doctor,
  flutter_pub_get,
  run_ionic,
  run_cordova,
  run_expo,
  list_devices,
  run_vscode_extension,
  run_project,
  stop_command,
  test_mcp,
  docker_build,
  docker_run,
  docker_compose,
  create_docker_compose,
  create_dockerfile,
  create_dockerignore
};

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const { id, method, params } = msg;
      console.log('MCP request:', { method, params, id });
      const fn = handlers[method];
      if (!fn) {
        console.error('Unknown MCP method:', method);
        sendError(`Unknown method: ${method}`, id);
        continue;
      }
      Promise.resolve(fn(params || {}))
        .then(res => {
          console.log('MCP response:', { method, result: res });
          send(res, id);
        })
        .catch(err => {
          console.error('MCP handler error:', { method, error: err?.message || String(err) });
          sendError(err?.message || String(err), id);
        });
    } catch (e) {
      console.error('MCP parse error:', e.message);
      // ignore malformed lines
    }
  }
});

