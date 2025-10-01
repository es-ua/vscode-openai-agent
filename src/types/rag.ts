export interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    type: 'code' | 'comment' | 'decision' | 'chat' | 'image';
    timestamp: string;
    path?: string;
    startLine?: number;
    endLine?: number;
    decisionId?: string;
    chatId?: string;
    tags?: string[];
    imageDescription?: string;
  };
}

export interface SearchOptions {
  limit?: number;
  types?: ('code' | 'comment' | 'decision' | 'chat' | 'image')[];
  excludeChatId?: string;
}

export interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: {
    type: 'code' | 'comment' | 'decision' | 'chat' | 'image';
    timestamp: string;
    path?: string;
    startLine?: number;
    endLine?: number;
    decisionId?: string;
    chatId?: string;
    tags?: string[];
    imageDescription?: string;
  };
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  reasoning: string;
  timestamp: string;
  tags: string[];
}

export interface ChatMessage {
  id: string;
  content: string;
  chatId: string;
  timestamp: string;
}

export interface RelevantContext {
  code: { content: string; path?: string; startLine?: number; endLine?: number; score: number }[];
  decisions: { title: string; description: string; id: string; tags: string[]; score: number }[];
  chatHistory: { content: string; chatId: string; timestamp: string; score: number }[];
  images: { description: string; id: string; score: number }[];
}

export interface CodeChunk {
  id: string;
  content: string;
  path: string;
  startLine: number;
  endLine: number;
  timestamp: string;
}
