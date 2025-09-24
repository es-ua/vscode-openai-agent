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

    console.log('Permissions after add:', this.permissions.permissions);
    this.savePermissions();
    
    // Notify webview about permission update
    if (this._view) {
      const stats = this.getPermissionStats();
      this._view.webview.postMessage({ type: 'permissionStats', stats });
    }
  }

  async requestPermission(command: string, description?: string): Promise<boolean> {
    console.log('requestPermission called for:', command, 'description:', description);
    // Check if we have a saved permission for this command
    const savedPermission = this.findPermission(command);
    if (savedPermission) {
      console.log('Found saved permission:', savedPermission);
      return savedPermission.allowed;
    }
    console.log('No saved permission found, requesting new permission');

    // If auto-approve is enabled, allow all commands
    if (this.permissions.autoApprove) {
      this.addPermission(command, true, description);
      return true;
    }

    // Request permission from user
    return new Promise((resolve) => {
      if (this._view) {
        this._view.webview.postMessage({
          type: 'requestPermission',
          command,
          description: description || `Execute command: ${command}`
        });

        // Listen for permission response with timeout
        let resolved = false;
        const messageHandler = (message: any) => {
          console.log('Received message in permission handler:', message);
          if (message.type === 'permissionResponse' && message.command === command && !resolved) {
            console.log('Permission response received:', message);
            resolved = true;
            this._view?.webview.onDidReceiveMessage(messageHandler);
            
            // Add permission with remember flag
            this.addPermission(command, message.allowed, description, message.remember || false);
            console.log('Permission added with remember flag:', message.remember || false);
            
            resolve(message.allowed);
          }
        };

        this._view.webview.onDidReceiveMessage(messageHandler);
        
        // Fallback timeout - if no response in 30 seconds, use VS Code notification
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this._view?.webview.onDidReceiveMessage(messageHandler);
            vscode.window.showWarningMessage(
              `Agent wants to execute: ${description || command}`,
              'Allow', 'Deny', 'Allow & Remember'
            ).then(selection => {
              if (selection === 'Allow') {
                this.addPermission(command, true, description, false);
                resolve(true);
              } else if (selection === 'Allow & Remember') {
                this.addPermission(command, true, description, true);
                resolve(true);
              } else {
                this.addPermission(command, false, description, false);
                resolve(false);
              }
            });
          }
        }, 30000);
      } else {
        // Fallback to VS Code notification if no webview
        vscode.window.showWarningMessage(
          `Agent wants to execute: ${description || command}`,
          'Allow', 'Deny', 'Allow & Remember'
        ).then(selection => {
          if (selection === 'Allow') {
            resolve(true);
          } else if (selection === 'Allow & Remember') {
            this.addPermission(command, true, description, true);
            resolve(true);
          } else {
            resolve(false);
          }
        });
      }
    });
  }

  setAutoApprove(enabled: boolean) {
    this.permissions.autoApprove = enabled;
    this.savePermissions();
  }

  getAutoApprove(): boolean {
    return this.permissions.autoApprove;
  }

  getAllPermissions(): Permission[] {
    return this.permissions.permissions;
  }

  clearPermissions() {
    this.permissions.permissions = [];
    this.savePermissions();
  }

  removePermission(command: string) {
    this.permissions.permissions = this.permissions.permissions.filter(p => p.command !== command);
    this.savePermissions();
  }

  getPermissionStats() {
    const total = this.permissions.permissions.length;
    const allowed = this.permissions.permissions.filter(p => p.allowed).length;
    const denied = total - allowed;
    
    console.log('getPermissionStats called. Total:', total, 'Allowed:', allowed, 'Denied:', denied, 'Auto-approve:', this.permissions.autoApprove);
    console.log('All permissions:', this.permissions.permissions);
    
    return {
      total,
      allowed,
      denied,
      autoApprove: this.permissions.autoApprove
    };
  }
}
