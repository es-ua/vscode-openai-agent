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
  const uploadImageButton = document.getElementById('upload-image');
  const imageFileInput = document.getElementById('image-file-input');
  const uploadAudioButton = document.getElementById('upload-audio');
  const audioFileInput = document.getElementById('audio-file-input');
  const app = document.getElementById('app');
  const transcriptionProgress = document.getElementById('transcription-progress');
  const transcriptionProgressFill = document.getElementById('transcription-progress-fill');
  const transcriptionProgressPercent = document.getElementById('transcription-progress-percent');
  const transcriptionProgressFilename = document.getElementById('transcription-progress-filename');
  
  // Хранилище прикреплённых файлов
  let attachedFiles = [];
  
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
      // Любая обработка = кнопка "Stop"
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
      console.log('Append message received:', msg.role, 'keepProcessing:', msg.keepProcessing);
      removeThinking();
      
      // Сбрасываем кнопку только если не идёт транскрипция
      if (!msg.keepProcessing) {
        console.log('Setting processing state to false');
        setProcessingState(false);
      } else {
        console.log('Keeping processing state (transcription in progress)');
      }
      
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
      
      // Сбрасываем кнопку только если не идёт транскрипция
      if (!msg.keepProcessing) {
        setProcessingState(false);
      }
      
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
        setProcessingState(true); // Блокируем кнопку = "Stop"
      } else if (msg.progress === 100) {
        hideTranscriptionProgress();
        setProcessingState(false); // Разблокируем кнопку = "Send"
      } else {
        updateTranscriptionProgress(msg.progress);
        // Кнопка остается "Stop" во время обработки
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
    form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
      // Убираем блокировку множественных запросов - позволяем фоновое выполнение
      
      const value = prompt ? prompt.value : '';
      
      // Устанавливаем состояние обработки сразу если есть файлы или текст
      if (attachedFiles.length > 0 || value.trim()) {
        setProcessingState(true);
      }
      
      // Если есть прикреплённые файлы, отправляем их сначала
      if (attachedFiles.length > 0) {
        // Отправляем все прикреплённые файлы
        for (let i = 0; i < attachedFiles.length; i++) {
          const isLastFile = (i === attachedFiles.length - 1) && !value.trim();
          await sendFile(attachedFiles[i], isLastFile);
        }
        
        // Очищаем прикреплённые файлы
        attachedFiles = [];
        showAttachedFiles();
      }
      
      // Отправляем текстовое сообщение если есть
      if (value.trim()) {
    append('user', value);
        if (prompt) {
    prompt.value = '';
        }
    
    vscode.postMessage({ 
      type: 'sendPrompt', 
      prompt: value
    });
      } else if (attachedFiles.length === 0) {
        // Если файлов больше нет и текста нет - сбрасываем состояние
        setProcessingState(false);
      }
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

  // Обработка загрузки изображений
  if (uploadImageButton && imageFileInput) {
    uploadImageButton.addEventListener('click', () => {
      imageFileInput.click();
    });

    imageFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        attachFile(file);
      }
      e.target.value = '';
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
        attachFile(file);
      }
      e.target.value = '';
    });
  }

  // Drag & Drop функциональность - только в области ввода сообщения
  if (form) {
    let dragCounter = 0; // Счётчик для правильной обработки dragleave
    let originalFormContent = null; // Сохраняем оригинальное содержимое
    let dropZoneActive = false; // Флаг активности визуальной зоны
    
    form.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      
      // Превращаем зону ввода в контейнер для файлов
      transformToDropZone();
    });

    form.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Меняем курсор на "копировать"
      e.dataTransfer.dropEffect = 'copy';
    });

    form.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      
      // Если курсор покинул форму — скрываем контейнер
      const rect = form.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside || dragCounter <= 0) {
        restoreToInputZone();
        dropZoneActive = false;
        dragCounter = 0;
      }
    });

    form.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        
        // Показываем анимацию принятия файла
        showFileAccepted(file);
        
        // Прикрепляем файл к сообщению
        attachFile(file);
      }
      
      // Возвращаем обычный вид с прикреплёнными файлами
      restoreToInputZone();
      dropZoneActive = false;
    });
    
    // Глобальные обработчики: активируют визуальную зону сразу при наведении
    const isFileDrag = (e) => {
      const types = e.dataTransfer && (e.dataTransfer.types || []);
      if (!types) return false;
      try {
        // Some browsers expose DOMStringList with contains()
        if (typeof types.contains === 'function') {
          return types.contains('Files');
        }
      } catch (_) {}
      return Array.from(types).includes('Files');
    };

    const maybeActivateDropZone = (e) => {
      // Разрешаем drop и предотвращаем открытие файла VS Code
      e.preventDefault();
      e.stopPropagation();
      if (!isFileDrag(e)) return;
      const rect = form.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside && !dropZoneActive) {
        transformToDropZone();
        dropZoneActive = true;
      } else if (!inside && dropZoneActive) {
        restoreToInputZone();
        dropZoneActive = false;
      }
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    // Навешиваем слушатели на document и body (в некоторых средах window не получает события drag из ОС)
    document.addEventListener('dragenter', maybeActivateDropZone, { passive: false, capture: true });
    document.addEventListener('dragover', maybeActivateDropZone, { passive: false, capture: true });
    document.documentElement && document.documentElement.addEventListener('dragenter', maybeActivateDropZone, { passive: false, capture: true });
    document.documentElement && document.documentElement.addEventListener('dragover', maybeActivateDropZone, { passive: false, capture: true });
    if (app) {
      app.addEventListener('dragenter', maybeActivateDropZone, { passive: false, capture: true });
      app.addEventListener('dragover', maybeActivateDropZone, { passive: false, capture: true });
    }
    // Глобально предотвращаем дефолт, чтобы VS Code не перехватывал drop
    document.addEventListener('drop', (e) => { e.preventDefault(); }, { passive: false, capture: true });

    // Если уходим курсором (dragleave на документе), скрываем контейнер
    document.addEventListener('dragleave', (e) => {
      // Когда курсор покидает окно, координаты могут стать (0,0) и relatedTarget = null
      const rect = form.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside && dropZoneActive) {
        restoreToInputZone();
        dropZoneActive = false;
        dragCounter = 0;
      }
    }, { capture: true });

    // Восстанавливаем состояние при дропе где угодно вне формы или окончании перетаскивания
    window.addEventListener('drop', () => {
      if (dropZoneActive) {
        restoreToInputZone();
        dropZoneActive = false;
      }
    });
    window.addEventListener('dragend', () => {
      if (dropZoneActive) {
        restoreToInputZone();
        dropZoneActive = false;
      }
    });
    
    // Функция превращения в зону для файлов
    function transformToDropZone() {
      // Сохраняем оригинальное содержимое
      if (!originalFormContent) {
        originalFormContent = form.innerHTML;
      }
      
      // Создаём контейнер для файлов
      form.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
          background: linear-gradient(135deg, rgba(33, 150, 243, 0.1), rgba(33, 150, 243, 0.05));
          border: 3px dashed rgba(33, 150, 243, 0.8);
          border-radius: 12px;
          transition: all 0.3s ease;
          min-height: 120px;
        ">
          <div style="
            font-size: 48px;
            margin-bottom: 16px;
            animation: dropZonePulse 1.5s ease-in-out infinite;
          ">📎</div>
          <div style="
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 8px;
          ">Отпустите файл здесь</div>
          <div style="
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
          ">Поддерживаются: изображения, аудио, PDF, текст и другие файлы</div>
        </div>
      `;
      
      // Добавляем CSS анимацию
      if (!document.getElementById('dropZoneStyles')) {
        const style = document.createElement('style');
        style.id = 'dropZoneStyles';
        style.textContent = `
          @keyframes dropZonePulse {
            0%, 100% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(1.1); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }
    }
    
    // Функция возврата к обычной зоне ввода
    function restoreToInputZone() {
      if (originalFormContent) {
        form.innerHTML = originalFormContent;
        // Восстанавливаем обработчики событий
        setupFormEventListeners();
      }
    }
    
    // Функция настройки обработчиков событий формы
    function setupFormEventListeners() {
      // Восстанавливаем обработчики для кнопок и инпутов
      const uploadImageButton = document.getElementById('upload-image');
      const imageFileInput = document.getElementById('image-file-input');
      const uploadAudioButton = document.getElementById('upload-audio');
      const audioFileInput = document.getElementById('audio-file-input');
      
      if (uploadImageButton && imageFileInput) {
        uploadImageButton.addEventListener('click', () => {
          imageFileInput.click();
        });
        imageFileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            attachFile(file);
          }
          e.target.value = '';
        });
      }
      
      if (uploadAudioButton && audioFileInput) {
        uploadAudioButton.addEventListener('click', () => {
          audioFileInput.click();
        });
        audioFileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            attachFile(file);
          }
          e.target.value = '';
        });
      }
    }
  }
  
  
  // Функция для показа анимации принятия файла
  function showFileAccepted(file) {
    const accepted = document.createElement('div');
    accepted.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(76, 175, 80, 0.9);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 1000;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fileAccepted 1s ease-out forwards;
    `;
    
    const icon = file.type.startsWith('image/') ? '🖼️' : 
                 file.type.startsWith('audio/') ? '🎵' : 
                 file.type === 'application/pdf' ? '📄' : '📎';
    
    accepted.textContent = `${icon} Файл принят: ${file.name}`;
    form.style.position = 'relative';
    form.appendChild(accepted);
    
    // Удаляем через 2 секунды
    setTimeout(() => {
      if (accepted.parentNode) {
        accepted.parentNode.removeChild(accepted);
      }
    }, 2000);
  }
  
  // Функция для прикрепления файла к текущему сообщению
  function attachFile(file) {
    // Проверяем размер файла (максимум 25MB)
    const maxSize = 25 * 1024 * 1024;
        if (file.size > maxSize) {
      append('assistant', '❌ Ошибка: Размер файла не должен превышать 25MB');
          return;
        }

    // Добавляем файл в массив
    attachedFiles.push(file);
    
    // Показываем прикреплённый файл в UI
    showAttachedFiles();
  }
  
  // Функция для отображения прикреплённых файлов
  function showAttachedFiles() {
    // Ищем или создаём контейнер для прикреплённых файлов
    let attachmentsContainer = document.getElementById('attachments-container');
    if (!attachmentsContainer) {
      attachmentsContainer = document.createElement('div');
      attachmentsContainer.id = 'attachments-container';
      attachmentsContainer.style.padding = '8px 12px';
      attachmentsContainer.style.borderTop = '1px solid var(--vscode-panel-border)';
      attachmentsContainer.style.display = 'flex';
      attachmentsContainer.style.gap = '8px';
      attachmentsContainer.style.flexWrap = 'wrap';
      
      // Вставляем контейнер перед формой
      form.parentNode.insertBefore(attachmentsContainer, form);
    }
    
    // Очищаем контейнер
    attachmentsContainer.innerHTML = '';
    
    // Показываем все прикреплённые файлы
    attachedFiles.forEach((file, index) => {
      const fileChip = document.createElement('div');
      fileChip.style.display = 'flex';
      fileChip.style.alignItems = 'center';
      fileChip.style.gap = '6px';
      fileChip.style.padding = '4px 8px';
      fileChip.style.backgroundColor = 'var(--vscode-badge-background)';
      fileChip.style.color = 'var(--vscode-badge-foreground)';
      fileChip.style.borderRadius = '3px';
      fileChip.style.fontSize = '12px';

      // Иконка
      const iconSpan = document.createElement('span');
      if (file.type.startsWith('image/')) iconSpan.textContent = '🖼️';
      else if (file.type.startsWith('audio/')) iconSpan.textContent = '🎵';
      else if (file.type === 'application/pdf') iconSpan.textContent = '📄';
      else if (file.type.startsWith('text/')) iconSpan.textContent = '📝';
      else iconSpan.textContent = '📎';

      // Имя файла
      const nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;

      // Кнопка удаления (без inline-обработчика, чтобы не нарушать CSP)
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.style.background = 'none';
      removeBtn.style.border = 'none';
      removeBtn.style.color = 'inherit';
      removeBtn.style.cursor = 'pointer';
      removeBtn.style.padding = '0 4px';
      removeBtn.addEventListener('click', () => {
        attachedFiles.splice(index, 1);
        showAttachedFiles();
      });

      fileChip.appendChild(iconSpan);
      fileChip.appendChild(nameSpan);
      fileChip.appendChild(removeBtn);

      attachmentsContainer.appendChild(fileChip);
    });
    
    // Скрываем контейнер если нет файлов
    if (attachedFiles.length === 0) {
      attachmentsContainer.style.display = 'none';
    } else {
      attachmentsContainer.style.display = 'flex';
    }
  }
  
  // Удаление прикреплённого файла (используется из обработчиков, а не inline)
  function removeAttachment(index) {
    attachedFiles.splice(index, 1);
    showAttachedFiles();
  }
  
  // Переменная для отслеживания ожидаемых загрузок файлов
  let pendingFileUploads = 0;
  
  // Функция для отправки файла в backend
  function sendFile(file, isLastFile = false) {
    return new Promise((resolve, reject) => {
      // Увеличиваем счётчик ожидаемых загрузок
      pendingFileUploads++;
      
      // Определяем тип файла и показываем в чате
      let fileType = 'File';
      let messageType = 'uploadFile';
      
      if (file.type.startsWith('image/')) {
        fileType = 'Image';
        messageType = 'pasteImage';
      } else if (file.type.startsWith('audio/') || file.type === 'video/mp4') {
        fileType = 'Audio';
        messageType = 'uploadAudio';
      } else if (file.type === 'application/pdf') {
        fileType = 'PDF';
        messageType = 'uploadFile';
      } else if (file.type.startsWith('text/')) {
        fileType = 'Text';
        messageType = 'uploadFile';
      }
      
      // Показываем файл в чате
      append('user', `[${fileType}: ${file.name}]`);
      
      // Читаем и отправляем файл
        const reader = new FileReader();
        reader.onload = (event) => {
        const fileData = event.target.result.split(',')[1];
        
        // Создаём обработчик для ответа от backend
        const uploadHandler = (msg) => {
          if ((msg.data.type === 'imageUploaded' && messageType === 'pasteImage' && msg.data.description === file.name) ||
              (msg.data.type === 'audioUploaded' && messageType === 'uploadAudio' && msg.data.filename === file.name) ||
              (msg.data.type === 'fileUploaded' && messageType === 'uploadFile' && msg.data.filename === file.name)) {
            window.removeEventListener('message', uploadHandler);
            pendingFileUploads--;
            
            // Если это последний файл и нет других ожидающих загрузок - сбрасываем состояние
            if (isLastFile && pendingFileUploads === 0) {
              // Не сбрасываем состояние здесь - оно сбросится после ответа AI
            }
            resolve();
          }
        };
        window.addEventListener('message', uploadHandler);
        
        // Отправляем в зависимости от типа
        if (messageType === 'pasteImage') {
          vscode.postMessage({
            type: 'pasteImage',
            imageData: fileData,
            description: file.name
          });
        } else if (messageType === 'uploadAudio') {
          vscode.postMessage({
            type: 'uploadAudio',
            audioData: fileData,
            filename: file.name,
            description: file.name
          });
        } else {
          vscode.postMessage({
            type: 'uploadFile',
            fileData: fileData,
            filename: file.name,
            fileType: file.type,
            description: file.name
          });
        }
        };
      reader.onerror = reject;
        reader.readAsDataURL(file);
    });
  }

})();
