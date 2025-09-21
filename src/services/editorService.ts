import * as vscode from 'vscode';

export class EditorService {
  public getActiveEditor(): vscode.TextEditor | undefined {
    return vscode.window.activeTextEditor;
  }
  
  public getCurrentDocument(): vscode.TextDocument | undefined {
    const editor = this.getActiveEditor();
    return editor?.document;
  }
  
  public getLanguageId(): string | undefined {
    return this.getCurrentDocument()?.languageId;
  }
  
  public getCurrentPosition(): vscode.Position | undefined {
    const editor = this.getActiveEditor();
    return editor?.selection.active;
  }
  
  public getContextBeforeCursor(maxLines: number = 10): string {
    const editor = this.getActiveEditor();
    if (!editor || !editor.document) {
      return '';
    }
    
    const document = editor.document;
    const position = editor.selection.active;
    
    // Get the current line
    const currentLine = position.line;
    
    // Determine the starting line, ensuring we don't go below 0
    const startLine = Math.max(0, currentLine - maxLines);
    
    // Get text from startLine to current position
    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      position
    );
    
    return document.getText(range);
  }
  
  public getCurrentLinePrefix(): string {
    const editor = this.getActiveEditor();
    if (!editor || !editor.document) {
      return '';
    }
    
    const document = editor.document;
    const position = editor.selection.active;
    
    // Get text from beginning of line to current cursor position
    const linePrefix = document.lineAt(position.line).text.substring(0, position.character);
    
    return linePrefix;
  }
  
  public getFileContext(): string {
    const document = this.getCurrentDocument();
    if (!document) {
      return '';
    }
    
    return document.getText();
  }
  
  public getContextAfterCursor(maxLines: number = 10): string {
    const editor = this.getActiveEditor();
    if (!editor || !editor.document) {
      return '';
    }
    
    const document = editor.document;
    const position = editor.selection.active;
    
    // Get the current line
    const currentLine = position.line;
    
    // Determine the ending line, ensuring we don't go beyond document length
    const endLine = Math.min(document.lineCount - 1, currentLine + maxLines);
    
    // Get text from current position to endLine
    const range = new vscode.Range(
      position,
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );
    
    return document.getText(range);
  }
  
  public getSelectedText(): string {
    const editor = this.getActiveEditor();
    if (!editor || !editor.document) {
      return '';
    }
    
    return editor.document.getText(editor.selection);
  }
}
