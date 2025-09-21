# VS Code OpenAI Agent

A VS Code extension that provides AI-powered code suggestions using the OpenAI Assistants API. This extension functions similarly to GitHub Copilot, offering context-aware code completion as you type.

## Features

- AI-powered code suggestions using OpenAI's Assistants API
- Persistent assistant with memory of your coding context
- Support for multiple programming languages
- Status bar indicator showing when the AI is generating suggestions
- Secure API key storage

## Why Assistants API?

Unlike traditional completions APIs, the OpenAI Assistants API provides:
- Persistent memory and context between suggestions
- More sophisticated understanding of code structure
- Built-in code interpreter capabilities
- Better handling of complex programming tasks

## Requirements

- Visual Studio Code 1.60.0 or higher
- An OpenAI API key with access to the Assistants API

## Getting Started

1. Install the extension
2. Set your OpenAI API key using the command palette:
   - Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Type "OpenAI Agent: Set API Key" and press Enter
   - Enter your API key when prompted
3. Start coding and receive AI-powered suggestions as you type

## Extension Settings

This extension contributes the following settings:

* `openaiAgent.enable`: Enable/disable the OpenAI Agent
* `openaiAgent.model`: OpenAI model to use for code suggestions (gpt-4, gpt-4-turbo, or gpt-3.5-turbo)
* `openaiAgent.maxTokens`: Maximum number of tokens for code completion

## Commands

* `OpenAI Agent: Enable`: Enable the OpenAI Agent
* `OpenAI Agent: Disable`: Disable the OpenAI Agent
* `OpenAI Agent: Set API Key`: Set your OpenAI API key
* `OpenAI Agent: Reset Context`: Clear the current thread and start a new conversation
* `OpenAI Agent: Reset Assistant`: Reset the assistant to default settings (useful if you encounter issues)

## Privacy & Security

- Your API key is stored securely using VS Code's built-in Secret Storage API
- Code context is sent to OpenAI only when generating suggestions
- No code or personal data is stored or logged beyond what's needed for the assistant to function

## License

This extension is licensed under the MIT License.


## External MCP servers

Configure in settings (settings.json):
```json
"openaiAgent.mcp.servers": [
  {
    "id": "my-tools",
    "command": "/usr/local/bin/my-mcp",
    "args": ["--stdio"],
    "cwd": "${workspaceFolder}",
    "env": { "FOO": "bar" },
    "tools": [
      {
        "name": "search",
        "method": "search",  
        "description": "Search text",
        "parameters": { "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] }
      }
    ]
  }
]
```
- Инструменты будут доступны ассистенту как `mcp:my-tools:search`.
- Команда для перезапуска: `OpenAI Agent: Reload MCP Servers`.
