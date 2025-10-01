import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Decision } from "../../types/rag";

export class DecisionManager {
  private decisions: Map<string, Decision>;
  private storageDir: string;

  constructor(workspacePath: string) {
    this.decisions = new Map();
    this.storageDir = path.join(workspacePath, ".vscode", "openai-agent", "decisions");
  }

  async initialize(): Promise<void> {
    try {
      // Создать директорию, если не существует
      await fs.promises.mkdir(this.storageDir, { recursive: true });

      // Загрузить существующие решения
      await this.loadDecisions();
    } catch (error) {
      console.error("Failed to initialize decision manager:", error);
      throw error;
    }
  }

  async addDecision(decision: Decision): Promise<void> {
    try {
      this.decisions.set(decision.id, decision);

      // Сохранить в файл
      const filePath = path.join(this.storageDir, `${decision.id}.json`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(decision, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Failed to add decision:", error);
      throw error;
    }
  }

  getDecision(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  getAllDecisions(): Decision[] {
    return Array.from(this.decisions.values());
  }

  getDecisionsByTag(tag: string): Decision[] {
    return Array.from(this.decisions.values()).filter(decision =>
      decision.tags.includes(tag)
    );
  }

  async updateDecision(decision: Decision): Promise<void> {
    try {
      this.decisions.set(decision.id, decision);

      // Обновить файл
      const filePath = path.join(this.storageDir, `${decision.id}.json`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(decision, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Failed to update decision:", error);
      throw error;
    }
  }

  async deleteDecision(id: string): Promise<void> {
    try {
      this.decisions.delete(id);

      // Удалить файл
      const filePath = path.join(this.storageDir, `${id}.json`);
      if (await this.fileExists(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error("Failed to delete decision:", error);
      throw error;
    }
  }

  private async loadDecisions(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(this.storageDir, file);
          const content = await fs.promises.readFile(filePath, "utf8");
          const decision: Decision = JSON.parse(content);
          this.decisions.set(decision.id, decision);
        }
      }
    } catch (error) {
      console.error("Failed to load decisions:", error);
      // Не выбрасываем ошибку, просто начинаем с пустого хранилища
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
