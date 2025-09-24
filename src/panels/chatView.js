// Основная функциональность чата
// Version 1.1 - Added Stop button functionality
(function() {
  console.log('Loading chatView.js v1.1 with Stop button functionality');
  const vscode = acquireVsCodeApi();
  
  // Элементы DOM
  const messages = document.getElementById('messages');
  const form = document.getElementById('form');
  const prompt = document.getElementById('prompt');
  const btnNew = document.getElementById('new');
  const tabs = document.getElementById('tabs');
  const modeSelect = document.getElementById('mode-select');
  const modelSelect = document.getElementById('model-select');
  const submitButton = form.querySelector('button[type="submit"]');
  
  console.log('Submit button found:', submitButton ? 'Yes' : 'No');
  
  // Состояние
  let state = vscode.getState() || {};
  if (!state.histories) state.histories = {};
  if (typeof state.active === 'undefined') state.active = null;
  let isProcessing = false;
  
  // Инициализация
  vscode.postMessage({ type: 'getCurrentModel' });
  
  // Функции для работы с UI
  function setActive(id) {
    state.active = id;
    vscode.setState(state);
  }
  
  function renderTabs(info) {
    tabs.innerHTML = '';
    
    if (!info || !info.threads || info.threads.length === 0) {
      return;
    }
    
    info.threads.forEach(id => {
      const el = document.createElement('div');
      el.className = 'tab' + (id === info.active ? ' active' : '');
      
      const threadName = (info.threadNames && info.threadNames[id]) || id.slice(0,6);
      el.textContent = threadName;
      
      el.onclick = function() {
        vscode.postMessage({ type: 'switchThread', id: id });
      };
      
      tabs.appendChild(el);
    });
    
    setActive(info.active || null);
  }
  
  function clearUI() {
    messages.innerHTML = '';
  }
  
  function showThinking(text) {
    console.log('showThinking called with text:', text);
    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking';
    thinkingEl.textContent = text || 'Thinking...';
    messages.appendChild(thinkingEl);
    messages.scrollTop = messages.scrollHeight;
    
    // Изменяем кнопку на "Stop"
    setProcessingState(true);
  }
  
  function updateThinking(text) {
    console.log('updateThinking called with text:', text);
    const thinkingEl = messages.querySelector('.thinking');
    if (thinkingEl) {
      thinkingEl.textContent = text;
      messages.scrollTop = messages.scrollHeight;
    }
  }
  
  function removeThinking() {
    console.log('removeThinking called');
    const thinkingEl = messages.querySelector('.thinking');
    if (thinkingEl) {
      thinkingEl.remove();
      console.log('Thinking element removed');
    } else {
      console.log('No thinking element found to remove');
    }
    
    // Возвращаем кнопку в состояние "Send"
    setProcessingState(false);
  }
  
  function setProcessingState(processing) {
    console.log('Setting processing state:', processing);
    isProcessing = processing;
    
    if (processing) {
      // Изменяем кнопку на "Stop"
      console.log('Changing button to Stop');
      submitButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
        </svg>
        Stop
      `;
      submitButton.classList.add('stop');
      prompt.disabled = true;
      console.log('Button classes after adding stop:', submitButton.className);
    } else {
      // Возвращаем кнопку в состояние "Send"
      console.log('Changing button to Send');
      submitButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
        </svg>
        Send
      `;
      submitButton.classList.remove('stop');
      prompt.disabled = false;
      console.log('Button classes after removing stop:', submitButton.className);
    }
  }
  
  function append(role, content) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    
    const roleDiv = document.createElement('div');
    roleDiv.className = 'msg-role';
    roleDiv.textContent = role === 'assistant' ? 'AI:' : 'You:';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';
    
    // Безопасно экранируем HTML и сохраняем переносы строк
    const safeContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    // Заменяем переносы строк на <br>
    textDiv.innerHTML = safeContent.split('\n').join('<br>');
    
    el.appendChild(roleDiv);
    el.appendChild(textDiv);
    
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }
  
  function renderHistory(history = []) {
    clearUI();
    history.forEach(m => append(m.role, m.content));
  }
  
  // Терминал
  let terminalIframe = null;
  let terminalReady = false;
  
  function showTerminal() {
    const terminalOutput = document.getElementById('terminal-output');
    if (terminalOutput) {
      terminalOutput.style.display = 'flex';
      terminalIframe = document.getElementById('terminal-iframe');
    }
  }
  
  function hideTerminal() {
    const terminalOutput = document.getElementById('terminal-output');
    if (terminalOutput) {
      terminalOutput.style.display = 'none';
    }
  }
  
  function sendToTerminal(type, text) {
    if (terminalIframe && terminalReady) {
      try {
        terminalIframe.contentWindow.postMessage({ type, text }, '*');
        
        // Если это последнее сообщение вывода, отправляем сигнал о завершении команды
        if (type === 'output' || type === 'error') {
          // Используем небольшую задержку, чтобы убедиться, что все сообщения обработаны
          setTimeout(() => {
            terminalIframe.contentWindow.postMessage({ type: 'command-end' }, '*');
          }, 500);
        }
      } catch (error) {
        console.error('Error sending message to terminal:', error);
      }
    } else {
      console.log('Terminal not ready yet, waiting...');
      setTimeout(() => sendToTerminal(type, text), 500);
    }
  }
  
  // Слушаем сообщения от iframe
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'terminal-ready') {
      console.log('Terminal is ready');
      terminalReady = true;
    } else if (event.data && event.data.type === 'terminal-analysis') {
      console.log('Terminal analysis:', event.data);
      // Отправляем результаты анализа в VS Code
      vscode.postMessage({
        type: 'terminalAnalysis',
        analysis: {
          command: event.data.command,
          output: event.data.output,
          errors: event.data.errors,
          hasErrors: event.data.hasErrors,
          hasSuccess: event.data.hasSuccess,
          duration: event.data.duration
        }
      });
    } else if (event.data && event.data.type === 'terminal-stop-command') {
      console.log('Terminal stop command requested:', event.data.command);
      // Отправляем запрос на остановку команды в VS Code
      vscode.postMessage({
        type: 'stopCommand',
        command: event.data.command
      });
    }
  });
  
  // Обработчик для закрытия терминала
  const terminalClose = document.getElementById('terminal-close');
  if (terminalClose) {
    terminalClose.addEventListener('click', hideTerminal);
  }
  
  // Обработчики событий
  window.addEventListener('message', (event) => {
    const msg = event.data;
    console.log('Received message from extension:', msg.type);
    
    if (msg.type === 'append') {
      console.log('Append message received:', msg.role);
      removeThinking();
      append(msg.role, msg.content);
    } else if (msg.type === 'thinking') {
      console.log('Thinking message received:', msg.content);
      showThinking(msg.content);
    } else if (msg.type === 'updateThinking') {
      console.log('UpdateThinking message received');
      updateThinking(msg.content);
    } else if (msg.type === 'error') {
      console.log('Error message received:', msg.message);
      removeThinking();
      append('assistant', 'Error: ' + msg.message);
    } else if (msg.type === 'threads') {
      renderTabs(msg.info);
    } else if (msg.type === 'loadHistory') {
      if (state.active && msg.history) {
        renderHistory(msg.history);
      }
    } else if (msg.type === 'clear') {
      clearUI();
    } else if (msg.type === 'modeChanged') {
      modeSelect.value = msg.mode;
    } else if (msg.type === 'modelChanged') {
      modelSelect.value = msg.model;
    } else if (msg.type === 'terminalCommand') {
      showTerminal();
      sendToTerminal('command', msg.command);
    } else if (msg.type === 'terminalOutput') {
      showTerminal();
      if (msg.isError) {
        sendToTerminal('error', msg.output);
      } else {
        sendToTerminal('output', msg.output);
      }
      
      // Если это сообщение содержит exitCode, значит команда завершена
      if (msg.exitCode !== undefined) {
        setTimeout(() => {
          terminalIframe.contentWindow.postMessage({ 
            type: 'command-end',
            exitCode: msg.exitCode,
            success: msg.exitCode === 0
          }, '*');
        }, 500);
      }
    }
  });
  
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Если в процессе обработки, то отменяем запрос
    if (isProcessing) {
      console.log('Cancelling current request');
      vscode.postMessage({ type: 'cancelRequest' });
      return;
    }
    
    const value = prompt.value;
    if (!value.trim()) return;
    
    append('user', value);
    prompt.value = '';
    
    vscode.postMessage({ 
      type: 'sendPrompt', 
      prompt: value
    });
  });
  
  btnNew.addEventListener('click', () => {
    vscode.postMessage({ type: 'newThread' });
  });
  
  modeSelect.addEventListener('change', (e) => {
    vscode.postMessage({ type: 'setMode', mode: e.target.value });
  });
  
  modelSelect.addEventListener('change', (e) => {
    vscode.postMessage({ type: 'setModel', model: e.target.value });
  });
  
  // Обработка Enter для textarea
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });
})();
