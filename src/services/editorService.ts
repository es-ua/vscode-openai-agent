import * as vscode from 'vscode';

export class EditorService {
  /**
   * Get the context before the cursor
   * @param lines Number of lines to include before the cursor
   * @returns The text before the cursor
   */
  public getContextBeforeCursor(lines: number = 10): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';
    
    const document = editor.document;
    const position = editor.selection.active;
    
    // Get the current line and character position
    const lineNumber = position.line;
    const charPosition = position.character;
    
    // Calculate the start line
    const startLine = Math.max(0, lineNumber - lines);
    
    // Get the text from the start line to the cursor position
    let context = '';
    
    // Add the lines before the current line
    for (let i = startLine; i < lineNumber; i++) {
      context += document.lineAt(i).text + '\n';
    }
    
    // Add the current line up to the cursor
    context += document.lineAt(lineNumber).text.substring(0, charPosition);
    
    return context;
  }
  
  /**
   * Get the surrounding context around the cursor or selection
   * @param lines Number of lines to include before and after the cursor or selection
   * @returns The text around the cursor or selection
   */
  public getSurroundingContext(lines: number = 10): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';
    
    const document = editor.document;
    const selection = editor.selection;
    
    // Get the start and end lines of the selection or cursor
    const startLine = Math.max(0, selection.start.line - lines);
    const endLine = Math.min(document.lineCount - 1, selection.end.line + lines);
    
    // Get the text from the start line to the end line
    let context = '';
    for (let i = startLine; i <= endLine; i++) {
      context += document.lineAt(i).text + '\n';
    }
    
    return context;
  }
  
  /**
   * Get the selected text or the current line if no text is selected
   * @returns The selected text or current line
   */
  public getSelectedText(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';
    
    const selection = editor.selection;
    
    // If there's a selection, return the selected text
    if (!selection.isEmpty) {
      return editor.document.getText(selection);
    }
    
    // Otherwise, return the current line
    const lineNumber = selection.active.line;
    return editor.document.lineAt(lineNumber).text;
  }
  
  /**
   * Get the entire file content
   * @returns The entire file content
   */
  public getFileContent(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';
    
    return editor.document.getText();
  }
  
  /**
   * Get the file path of the active editor
   * @returns The file path or undefined if no editor is active
   */
  public getFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    
    return editor.document.uri.fsPath;
  }
  
  /**
   * Get the language ID of the active editor
   * @returns The language ID or undefined if no editor is active
   */
  public getLanguageId(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    
    return editor.document.languageId;
  }
}
