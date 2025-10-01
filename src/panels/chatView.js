// Основная функциональность чата
// Version 1.1 - Added Stop button functionality
(function() {
  console.log('Loading chatView.js v1.1 with Stop button functionality');
  const vscode = acquireVsCodeApi();
  
  // Элементы DOM
  const messages = document.getElementById('messages');
  const form = document.getElementById('form');
  const prompt = document.getElementById('prompt');
  const btnNew = document.getElementById('new-thread');
  const threadSelect = document.getElementById('thread-select');
  const renameThreadBtn = document.getElementById('rename-thread');
  const deleteThreadBtn = document.getElementById('delete-thread');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const uploadAudioButton = document.getElementById('upload-audio');
  const audioFileInput = document.getElementById('audio-file-input');
  const transcribeAudioButton = document.getElementById('transcribe-audio');
  const transcribeFileInput = document.getElementById('transcribe-file-input');
  const dragDropOverlay = document.getElementById('drag-drop-overlay');
  const app = document.getElementById('app');
  const transcriptionProgress = document.getElementById('transcription-progress');
  const transcriptionProgressFill = document.getElementById('transcription-progress-fill');
  const transcriptionProgressPercent = document.getElementById('transcription-progress-percent');
  const transcriptionProgressFilename = document.getElementById('transcription-progress-filename');
  
  console.log('Submit button found:', submitButton ? 'Yes' : 'No');
  
  // Состояние
  let state = vscode.getState() || {};
  if (!state.histories) state.histories = {};
  if (typeof state.active === 'undefined') state.active = null;
  let isProcessing = false;
  
  // Функции для управления прогрессом транскрипции
  function showTranscriptionProgress(filename) {
    if (transcriptionProgress && transcriptionProgressFilename) {
      transcriptionProgressFilename.textContent = filename;
      transcriptionProgress.style.display = 'block';
      updateTranscriptionProgress(0, 'Starting...');
    }
  }
  
  function updateTranscriptionProgress(percent, status = null) {
    if (transcriptionProgressFill && transcriptionProgressPercent) {
      transcriptionProgressFill.style.width = percent + '%';
      transcriptionProgressPercent.textContent = percent + '%';
      
      // Update status text based on progress
      const statusText = document.getElementById('transcription-progress-text');
      if (statusText) {
        if (status) {
          statusText.textContent = status;
        } else if (percent === 0) {
          statusText.textContent = 'Preparing file...';
        } else if (percent === 25) {
          statusText.textContent = 'Uploading to Whisper AI...';
        } else if (percent === 75) {
          statusText.textContent = 'Processing with Whisper AI...';
        } else if (percent === 100) {
          statusText.textContent = 'Transcription complete!';
        } else {
          statusText.textContent = 'Processing audio with Whisper AI...';
        }
      }
    }
  }
  
  function hideTranscriptionProgress() {
    if (transcriptionProgress) {
      transcriptionProgress.style.display = 'none';
    }
  }
  
  // Инициализация
  vscode.postMessage({ type: 'getCurrentModel' });
  
  // Обработка сообщений от расширения
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'setTranscriptionLanguage') {
      // Сохраняем язык транскрипции в состоянии
      if (!state.transcriptionLanguage) {
        state.transcriptionLanguage = message.language;
        vscode.setState(state);
      }
    }
  });
  
  // Функции для работы с UI
  function setActive(id) {
    state.active = id;
    vscode.setState(state);
  }
  
  function renderTabs(info) {
    if (!threadSelect) {
      console.warn('Thread select element not found');
      return;
    }
    
    threadSelect.innerHTML = '';
    
    if (!info || !info.threads || info.threads.length === 0) {
      return;
    }
    
    info.threads.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = (info.threadNames && info.threadNames[id]) || id.slice(0,6);
      if (id === info.active) {
        option.selected = true;
      }
      threadSelect.appendChild(option);
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
    console.log('Append function called:', role, content);
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    
    const roleDiv = document.createElement('div');
    roleDiv.className = 'msg-role';
    roleDiv.textContent = role === 'assistant' ? 'AI:' : 'You:';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';
    
    // Проверяем, является ли контент аудиофайлом
    if (content.includes('[Audio:') || content.includes('[Audio Transcription:')) {
      textDiv.innerHTML = formatAudioContent(content);
    } else {
      // Безопасно экранируем HTML и сохраняем переносы строк
      const safeContent = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      
      // Заменяем переносы строк на <br>
      textDiv.innerHTML = safeContent.split('\n').join('<br>');
    }
    
    el.appendChild(roleDiv);
    el.appendChild(textDiv);
    
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    console.log('Message appended to DOM, total messages:', messages.children.length);
  }

  function formatAudioContent(content) {
    // Обрабатываем аудиофайлы
    if (content.includes('[Audio Transcription:')) {
      const match = content.match(/\[Audio Transcription: ([^\]]+)\]\n(.*)/s);
      if (match) {
        const filename = match[1];
        const transcription = match[2];
        return `
          <div class="audio-attachment">
            <div class="audio-header">
              <span class="audio-icon">🎤</span>
              <span class="audio-filename">${filename}</span>
              <span class="audio-type">Transcribed</span>
            </div>
            <div class="audio-transcription">${transcription.replace(/\n/g, '<br>')}</div>
          </div>
        `;
      }
    } else if (content.includes('[Audio:')) {
      const match = content.match(/\[Audio: ([^\]]+)\]/);
      if (match) {
        const filename = match[1];
        return `
          <div class="audio-attachment">
            <div class="audio-header">
              <span class="audio-icon">🎵</span>
              <span class="audio-filename">${filename}</span>
              <span class="audio-type">Audio File</span>
            </div>
          </div>
        `;
      }
    }
    
    // Если не удалось распарсить, возвращаем обычный контент
    const safeContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    return safeContent.split('\n').join('<br>');
  }
  
  function renderHistory(history = []) {
    console.log('Rendering history:', history);
    clearUI();
    if (Array.isArray(history)) {
      history.forEach(m => {
        console.log('Rendering message:', m.role, m.content);
        append(m.role, m.content);
      });
    }
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
      setProcessingState(false);
      append(msg.role, msg.content);
    } else if (msg.type === 'thinking') {
      console.log('Thinking message received:', msg.content);
      setProcessingState(true);
      showThinking(msg.content);
    } else if (msg.type === 'updateThinking') {
      console.log('UpdateThinking message received');
      updateThinking(msg.content);
    } else if (msg.type === 'error') {
      console.log('Error message received:', msg.message);
      removeThinking();
      setProcessingState(false);
      append('assistant', 'Error: ' + msg.message);
    } else if (msg.type === 'cancelRequest') {
      console.log('Request cancelled');
      removeThinking();
      setProcessingState(false);
      append('assistant', 'Запрос отменен');
    } else if (msg.type === 'transcriptionProgress') {
      console.log('Transcription progress:', msg.progress + '%');
      if (msg.progress === 0) {
        showTranscriptionProgress(msg.filename);
      } else if (msg.progress === 100) {
        hideTranscriptionProgress();
      } else {
        updateTranscriptionProgress(msg.progress);
      }
    } else if (msg.type === 'threads') {
      renderTabs(msg.info);
    } else if (msg.type === 'loadHistory') {
      console.log('LoadHistory message received:', msg.history);
      if (msg.history && Array.isArray(msg.history)) {
        renderHistory(msg.history);
      } else {
        console.log('No valid history data received');
      }
    } else if (msg.type === 'clear') {
      clearUI();
    } else if (msg.type === 'modeChanged') {
      // modeSelect не существует в текущем HTML
      console.log('Mode changed to:', msg.mode);
    } else if (msg.type === 'modelChanged') {
      // modelSelect не существует в текущем HTML
      console.log('Model changed to:', msg.model);
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
  
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      // Убираем блокировку множественных запросов - позволяем фоновое выполнение
      
      const value = prompt ? prompt.value : '';
      if (!value.trim()) return;
      
      append('user', value);
      if (prompt) {
        prompt.value = '';
      }
      
      // Устанавливаем состояние обработки
      setProcessingState(true);
      
      vscode.postMessage({ 
        type: 'sendPrompt', 
        prompt: value
      });
    });
  }
  
  if (btnNew) {
    btnNew.addEventListener('click', () => {
      vscode.postMessage({ type: 'newThread' });
    });
  }
  
  if (threadSelect) {
    threadSelect.addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setActiveThread', threadId: e.target.value });
    });
  }
  
  if (renameThreadBtn) {
    renameThreadBtn.addEventListener('click', () => {
      const currentThreadId = threadSelect ? threadSelect.value : null;
      if (currentThreadId) {
        // Используем встроенный prompt VS Code
        vscode.postMessage({ 
          type: 'showInputBox', 
          prompt: 'Enter new thread name:',
          value: '',
          callbackType: 'renameThread',
          threadId: currentThreadId
        });
      }
    });
  }
  
  if (deleteThreadBtn) {
    deleteThreadBtn.addEventListener('click', () => {
      const currentThreadId = threadSelect ? threadSelect.value : null;
      if (currentThreadId) {
        // Используем встроенный confirm VS Code
        vscode.postMessage({ 
          type: 'showConfirmDialog', 
          message: 'Are you sure you want to delete this thread? This action cannot be undone.',
          callbackType: 'deleteThread',
          threadId: currentThreadId
        });
      }
    });
  }
  
  // Обработка Enter для textarea
  if (prompt) {
    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (form) {
          form.dispatchEvent(new Event('submit'));
        }
      }
    });
  }

  // Обработка загрузки аудиофайлов
  if (uploadAudioButton && audioFileInput) {
    uploadAudioButton.addEventListener('click', () => {
      audioFileInput.click();
    });

    audioFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Проверяем тип файла
        const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'audio/m4a', 'audio/x-m4a'];
        if (!allowedTypes.includes(file.type)) {
          append('assistant', '❌ Ошибка: Пожалуйста, выберите MP3, MP4 или M4A файл');
          return;
        }

        // Проверяем размер файла (максимум 25MB для OpenAI)
        const maxSize = 25 * 1024 * 1024; // 25MB
        if (file.size > maxSize) {
          append('assistant', '❌ Ошибка: Размер файла не должен превышать 25MB');
          return;
        }

        // Показываем уведомление о загрузке
        append('assistant', '📤 Загружаю аудиофайл...');
        
        const reader = new FileReader();
        reader.onload = (event) => {
          const audioData = event.target.result.split(',')[1]; // Убираем data:audio/mp3;base64,
          vscode.postMessage({
            type: 'uploadAudio',
            audioData: audioData,
            filename: file.name,
            description: `Uploaded ${file.name}`
          });
        };
        reader.readAsDataURL(file);
        
        // Очищаем input для возможности повторной загрузки того же файла
        e.target.value = '';
      }
    });
  }

  // Обработка транскрипции аудиофайлов
  if (transcribeAudioButton && transcribeFileInput) {
    transcribeAudioButton.addEventListener('click', () => {
      transcribeFileInput.click();
    });

    transcribeFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Проверяем тип файла
        const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'audio/m4a', 'audio/x-m4a'];
        if (!allowedTypes.includes(file.type)) {
          append('assistant', '❌ Ошибка: Пожалуйста, выберите MP3, MP4 или M4A файл');
          return;
        }

        // Проверяем размер файла (максимум 25MB для OpenAI)
        const maxSize = 25 * 1024 * 1024; // 25MB
        if (file.size > maxSize) {
          append('assistant', '❌ Ошибка: Размер файла не должен превышать 25MB');
          return;
        }

        // Используем язык по умолчанию или автоопределение
        const defaultLanguage = vscode.getState()?.transcriptionLanguage || '';
        const language = defaultLanguage || undefined;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          const audioData = event.target.result.split(',')[1]; // Убираем data:audio/mp3;base64,
          vscode.postMessage({
            type: 'transcribeAudio',
            audioData: audioData,
            filename: file.name,
            language: language || defaultLanguage || undefined
          });
        };
        reader.readAsDataURL(file);
        
        // Очищаем input для возможности повторной загрузки того же файла
        e.target.value = '';
      }
    });
  }

  // Drag & Drop функциональность
  if (app && dragDropOverlay) {
    // Показываем overlay при перетаскивании
    app.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDropOverlay.style.display = 'flex';
    });

    app.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    app.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Скрываем overlay только если мы покидаем весь app контейнер
      if (!app.contains(e.relatedTarget)) {
        dragDropOverlay.style.display = 'none';
      }
    });

    app.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDropOverlay.style.display = 'none';

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        handleAudioFile(file);
      }
    });

    // Обработка клика на overlay для выбора режима
    dragDropOverlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDropOverlay.style.display = 'none';
    });

    // Обработка клика на иконки в overlay
    const dragDropIcons = dragDropOverlay.querySelectorAll('#drag-drop-icon');
    dragDropIcons.forEach((icon, index) => {
      icon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDropOverlay.style.display = 'none';
        
        // Если есть файлы в буфере обмена
        if (window.droppedFiles && window.droppedFiles.length > 0) {
          const file = window.droppedFiles[0];
          if (index === 0) {
            // Загрузка аудио
            handleAudioUpload(file);
          } else {
            // Транскрипция аудио
            handleAudioTranscription(file);
          }
        }
      });
    });
  }

  // Функция для обработки переташенного аудиофайла
  function handleAudioFile(file) {
    // Сохраняем файл для использования в overlay
    window.droppedFiles = [file];
    
    // Проверяем тип файла
    const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'audio/m4a', 'audio/x-m4a'];
    if (!allowedTypes.includes(file.type)) {
      append('assistant', '❌ Ошибка: Пожалуйста, перетащите MP3, MP4 или M4A файл');
      return;
    }

    // Проверяем размер файла (максимум 25MB для OpenAI)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      append('assistant', '❌ Ошибка: Размер файла не должен превышать 25MB');
      return;
    }

    // Показываем overlay с выбором действия
    dragDropOverlay.style.display = 'flex';
  }

  // Функция для загрузки аудио
  function handleAudioUpload(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const audioData = event.target.result.split(',')[1]; // Убираем data:audio/mp3;base64,
      vscode.postMessage({
        type: 'uploadAudio',
        audioData: audioData,
        filename: file.name,
        description: `Uploaded ${file.name}`
      });
    };
    reader.readAsDataURL(file);
  }

  // Функция для транскрипции аудио
  function handleAudioTranscription(file) {
    // Используем язык по умолчанию или автоопределение
    const defaultLanguage = vscode.getState()?.transcriptionLanguage || '';
    const language = defaultLanguage || undefined;
    
    // Показываем прогресс транскрипции
    showTranscriptionProgress(file.name);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const audioData = event.target.result.split(',')[1]; // Убираем data:audio/mp3;base64,
      vscode.postMessage({
        type: 'transcribeAudio',
        audioData: audioData,
        filename: file.name,
        language: language || defaultLanguage || undefined
      });
    };
    reader.readAsDataURL(file);
  }
})();
