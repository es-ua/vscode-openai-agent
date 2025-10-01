import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface Permission {
  command: string;
  allowed: boolean;
  timestamp: number;
  description?: string;
  remembered?: boolean;
}

export interface PermissionConfig {
  permissions: Permission[];
  autoApprove: boolean;
  lastUpdated: number;
}

export class PermissionService {
  private configPath: string;
  private permissions: PermissionConfig;
  private _view?: vscode.WebviewView;

  constructor(workspaceRoot: string) {
    // Use the current workspace folder instead of the extension path
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      this.configPath = path.join(workspaceFolder, '.vscode', 'agent-permissions.json');
    } else {
      this.configPath = path.join(workspaceRoot, '.vscode', 'agent-permissions.json');
    }
    console.log('PermissionService config path:', this.configPath);
    this.permissions = {
      permissions: [],
      autoApprove: false,
      lastUpdated: Date.now()
    };
    this.loadPermissions();
  }

  setView(view: vscode.WebviewView) {
    this._view = view;
    // Send initial permission stats to webview
    const stats = this.getPermissionStats();
    this._view.webview.postMessage({ type: 'permissionStats', stats });
  }

  private loadPermissions() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.permissions = JSON.parse(data);
        console.log('Loaded permissions from:', this.configPath);
        console.log('Loaded permissions:', this.permissions);
      } else {
        console.log('No permissions file found at:', this.configPath);
      }
    } catch (error) {
      console.error('Error loading permissions:', error);
    }
  }

  private savePermissions() {
    try {
      // Ensure .vscode directory exists
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      this.permissions.lastUpdated = Date.now();
      console.log('Saving permissions to:', this.configPath);
      console.log('Permissions to save:', this.permissions);
      fs.writeFileSync(this.configPath, JSON.stringify(this.permissions, null, 2));
      console.log('Permissions saved successfully');
    } catch (error) {
      console.error('Error saving permissions:', error);
    }
  }

  private findPermission(command: string): Permission | undefined {
    const permission = this.permissions.permissions.find(p => p.command === command && p.remembered === true);
    console.log('findPermission for', command, ':', permission);
    console.log('All permissions:', this.permissions.permissions);
    return permission;
  }

  private addPermission(command: string, allowed: boolean, description?: string, remembered: boolean = false) {
    console.log('addPermission called with:', { command, allowed, description, remembered });
    const existingIndex = this.permissions.permissions.findIndex(p => p.command === command);
    const permission: Permission = {
      command,
      allowed,
      timestamp: Date.now(),
      description,
      remembered
    };

    if (existingIndex >= 0) {
      console.log('Updating existing permission at index:', existingIndex);
      this.permissions.permissions[existingIndex] = permission;
    } else {
      console.log('Adding new permission');
      this.permissions.permissions.push(permission);
    }
    this.savePermissions();
    
    // Update webview with new stats
    this.updatePermissionStats();
  }

  private updatePermissionStats() {
    if (this._view) {
      const stats = this.getPermissionStats();
      console.log('Sending updated permission stats:', stats);
      this._view.webview.postMessage({ type: 'permissionStats', stats });
    }
  }

  public async requestPermission(command: string, description?: string): Promise<boolean> {
    console.log('requestPermission called for command:', command);
    
    // Check if we already have a remembered permission
    const existingPermission = this.findPermission(command);
    if (existingPermission) {
      console.log('Found existing permission:', existingPermission);
      return existingPermission.allowed;
    }

    // If auto-approve is enabled, automatically allow
    if (this.permissions.autoApprove) {
      console.log('Auto-approve enabled, automatically allowing command');
      this.addPermission(command, true, description, true);
      return true;
    }

    // Otherwise, ask the user
    return new Promise<boolean>((resolve) => {
      if (!this._view) {
        console.warn('No webview available for permission request');
        resolve(false);
        return;
      }

      const requestId = Date.now().toString();
      
      // Create a disposable to handle the response
      const listener = (message: any) => {
        if (message.data.type === 'permissionResponse' && message.data.id === requestId) {
          this._view?.webview.onDidReceiveMessage(listener);
          
          const allowed = message.data.response === 'allow';
          const remember = message.data.remember === true;
          
          console.log('Received permission response:', { allowed, remember });
          
          // Add the permission if it should be remembered
          if (remember) {
            this.addPermission(command, allowed, description, true);
          }
          
          resolve(allowed);
        }
      };
      
      // Add the listener
      this._view.webview.onDidReceiveMessage(listener);

      // Send the permission request to the webview
      console.log('Sending permission request to webview:', { command, description });
      this._view.webview.postMessage({
        type: 'permissionRequest',
        id: requestId,
        command,
        description
      });
    });
  }

  public handlePermissionResponse(id: string, response: string, remember: boolean) {
    console.log('handlePermissionResponse called with:', { id, response, remember });
    if (this._view) {
      this._view.webview.postMessage({
        type: 'permissionResponse',
        id,
        response,
        remember
      });
    }
  }

  public stopCommand() {
    console.log('stopCommand called');
    if (this._view) {
      this._view.webview.postMessage({
        type: 'terminal_command_end',
        success: false,
        message: 'Command stopped by user'
      });
    }
  }

  public getPermissionStats() {
    const allowed = this.permissions.permissions.filter(p => p.allowed && p.remembered).length;
    const denied = this.permissions.permissions.filter(p => !p.allowed && p.remembered).length;
    return { allowed, denied };
  }

  public setAutoApprove(value: boolean) {
    this.permissions.autoApprove = value;
    this.savePermissions();
  }

  public getAutoApprove(): boolean {
    return this.permissions.autoApprove;
  }

  public clearPermissions() {
    this.permissions.permissions = [];
    this.savePermissions();
    this.updatePermissionStats();
  }
}
