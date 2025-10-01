import { OpenAIEmbeddings } from "@langchain/openai";
import * as vscode from "vscode";

export class EmbeddingService {
  private embeddings: OpenAIEmbeddings;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: "text-embedding-3-small",
      dimensions: 1536,
    });
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddings.embedQuery(text);
      return result;
    } catch (error) {
      console.error("Failed to generate embedding:", error);
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const result = await this.embeddings.embedDocuments(texts);
      return result;
    } catch (error) {
      console.error("Failed to generate embeddings:", error);
      throw new Error(`Failed to generate embeddings: ${error}`);
    }
  }

  async generateImageDescription(imageData: Buffer): Promise<string> {
    // TODO: Реализовать генерацию описания изображения через GPT-4V
    // Пока возвращаем заглушку
    return "Image uploaded to chat";
  }
}
