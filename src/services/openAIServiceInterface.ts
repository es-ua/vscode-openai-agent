import * as vscode from 'vscode';
import { PermissionService } from './permissionService';

export interface OpenAIServiceInterface {
  initialize(): Promise<void>;
  setView(view: vscode.WebviewView): void;
  chat(prompt: string, onThinking?: (step: string) => void): Promise<string>;
  newThread(): Promise<string>;
  getThreadInfo(): { threads: string[]; active: string | undefined; threadNames: { [id: string]: string } };
  getCurrentThread(): any;
  getThreadHistory(threadId: string): Promise<any[]>;
  setActiveThread(threadId: string): Promise<void>;
  setThreadName(threadId: string, name: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  getThreads(): Promise<string[]>;
  cancelCurrentRun(): Promise<void>;
  getPermissionService(): PermissionService;
  getCompletion(context: string, language: string): Promise<string | null>;
  indexWorkspaceCode(): Promise<void>;
  searchContext(query: string): Promise<any[]>;
  addDecision(decision: { title: string; description: string; reasoning: string; tags: string[] }): Promise<void>;
  getRelevantDecisions(query: string): Promise<any[]>;
  addImage(imageData: Buffer, description: string): Promise<string>;
  addAudio(audioData: Buffer, filename: string, description: string): Promise<string>;
  transcribeAudio(audioData: Buffer, filename: string, language?: string, onProgress?: (progress: number) => void): Promise<string>;
  transcribeAudioByFilename(filename: string, language?: string, onProgress?: (progress: number) => void): Promise<string>;
}
