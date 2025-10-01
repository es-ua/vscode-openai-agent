import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Класс для динамической загрузки RAG-зависимостей
 */
export class RagLoader {
  private static instance: RagLoader;
  private isLoaded: boolean = false;
  private loadPromise: Promise<boolean> | null = null;
  private langchain: any;
  private chromadb: any;
  private openaiEmbeddings: any;

  private constructor() {}

  public static getInstance(): RagLoader {
    if (!RagLoader.instance) {
      RagLoader.instance = new RagLoader();
    }
    return RagLoader.instance;
  }

  /**
   * Проверяет, включен ли RAG в настройках
   */
  public isRagEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('openaiAgent');
    return config.get<boolean>('rag.enabled') || false;
  }

  /**
   * Загружает необходимые зависимости для RAG
   */
  public async loadDependencies(): Promise<boolean> {
    if (this.isLoaded) {
      return true;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise<boolean>(async (resolve, reject) => {
      try {
        // Проверяем, включен ли RAG
        if (!this.isRagEnabled()) {
          console.log('RAG is disabled in settings');
          resolve(false);
          return;
        }

        // Проверяем наличие необходимых пакетов
        const extensionPath = vscode.extensions.getExtension('vscode-openai-agent')?.extensionPath || '';
        const nodeModulesPath = path.join(extensionPath, 'node_modules');
        
        const requiredPackages = ['@langchain/openai', 'langchain', 'chromadb'];
        const missingPackages = [];

        for (const pkg of requiredPackages) {
          const pkgPath = path.join(nodeModulesPath, pkg);
          if (!fs.existsSync(pkgPath)) {
            missingPackages.push(pkg);
          }
        }

        if (missingPackages.length > 0) {
          const message = `RAG features require additional packages: ${missingPackages.join(', ')}. Install them?`;
          const install = 'Install';
          const disable = 'Disable RAG';
          const response = await vscode.window.showWarningMessage(message, install, disable);
          
          if (response === install) {
            await this.installPackages(missingPackages);
          } else if (response === disable) {
            await vscode.workspace.getConfiguration('openaiAgent').update('rag.enabled', false, true);
            resolve(false);
            return;
          } else {
            resolve(false);
            return;
          }
        }

        // Динамически импортируем зависимости
        try {
          // Используем require вместо import для динамической загрузки
          // @ts-ignore
          this.langchain = require('langchain');
          // @ts-ignore
          this.chromadb = require('chromadb');
          // @ts-ignore
          const openaiModule = require('@langchain/openai');
          this.openaiEmbeddings = openaiModule.OpenAIEmbeddings;
          
          this.isLoaded = true;
          resolve(true);
        } catch (error) {
          console.error('Failed to import RAG dependencies:', error);
          vscode.window.showErrorMessage(`Failed to load RAG dependencies: ${error}`);
          resolve(false);
        }
      } catch (error) {
        console.error('Error loading RAG dependencies:', error);
        reject(error);
      }
    });

    return this.loadPromise;
  }

  /**
   * Устанавливает недостающие пакеты
   */
  private async installPackages(packages: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const terminal = vscode.window.createTerminal('RAG Dependencies');
      terminal.show();
      terminal.sendText(`npm install ${packages.join(' ')}`);
      
      // Ждем завершения установки
      const disposable = vscode.window.onDidCloseTerminal(closedTerminal => {
        if (closedTerminal === terminal) {
          disposable.dispose();
          if (terminal.exitStatus?.code === 0) {
            resolve();
          } else {
            reject(new Error(`Failed to install packages: ${terminal.exitStatus?.code}`));
          }
        }
      });
    });
  }

  /**
   * Возвращает загруженные модули
   */
  public getLangchain() {
    return this.langchain;
  }

  public getChromadb() {
    return this.chromadb;
  }

  public getOpenAIEmbeddings() {
    return this.openaiEmbeddings;
  }
}
