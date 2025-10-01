(function() {
  const vscode = acquireVsCodeApi();
  
  // DOM Elements
  const searchInput = document.getElementById('search');
  const searchBtn = document.getElementById('search-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const codeResults = document.getElementById('code-results');
  const decisionsResults = document.getElementById('decisions-results');
  const chatResults = document.getElementById('chat-results');
  
  // Event listeners
  searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
      search(query);
    }
  });
  
  searchInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      searchBtn.click();
    }
  });
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all tabs
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(`${tabId}-results`).classList.add('active');
    });
  });
  
  // Functions
  function search(query) {
    showLoading();
    
    vscode.postMessage({
      type: 'search',
      query
    });
  }
  
  function showLoading() {
    codeResults.innerHTML = '<div class="loading">Searching code...</div>';
    decisionsResults.innerHTML = '<div class="loading">Searching decisions...</div>';
    chatResults.innerHTML = '<div class="loading">Searching chat history...</div>';
  }
  
  function renderResults(results) {
    // Clear previous results
    codeResults.innerHTML = '';
    decisionsResults.innerHTML = '';
    chatResults.innerHTML = '';
    
    const codeItems = results.filter(r => r.type === 'code');
    const decisionItems = results.filter(r => r.type === 'decision');
    const chatItems = results.filter(r => r.type === 'chat');
    
    // Render code results
    if (codeItems.length === 0) {
      codeResults.innerHTML = '<div class="empty-state">No code results found</div>';
    } else {
      codeItems.forEach(item => {
        const resultEl = createCodeResultElement(item);
        codeResults.appendChild(resultEl);
      });
    }
    
    // Render decision results
    if (decisionItems.length === 0) {
      decisionsResults.innerHTML = '<div class="empty-state">No decision results found</div>';
    } else {
      decisionItems.forEach(item => {
        const resultEl = createDecisionResultElement(item);
        decisionsResults.appendChild(resultEl);
      });
    }
    
    // Render chat results
    if (chatItems.length === 0) {
      chatResults.innerHTML = '<div class="empty-state">No chat history results found</div>';
    } else {
      chatItems.forEach(item => {
        const resultEl = createChatResultElement(item);
        chatResults.appendChild(resultEl);
      });
    }
  }
  
  function createCodeResultElement(item) {
    const resultEl = document.createElement('div');
    resultEl.className = 'result-item code-item';
    
    const header = document.createElement('div');
    header.className = 'result-header';
    
    const title = document.createElement('h3');
    title.textContent = item.path;
    title.title = item.path;
    
    const score = document.createElement('span');
    score.className = 'result-score';
    score.textContent = `${Math.round(item.score * 100)}%`;
    
    header.appendChild(title);
    header.appendChild(score);
    
    const content = document.createElement('pre');
    content.className = 'result-content code-content';
    content.textContent = item.content;
    
    const footer = document.createElement('div');
    footer.className = 'result-footer';
    
    const openBtn = document.createElement('button');
    openBtn.className = 'open-btn';
    openBtn.textContent = 'Open File';
    openBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'openFile',
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine
      });
    });
    
    footer.appendChild(openBtn);
    
    resultEl.appendChild(header);
    resultEl.appendChild(content);
    resultEl.appendChild(footer);
    
    return resultEl;
  }
  
  function createDecisionResultElement(item) {
    const resultEl = document.createElement('div');
    resultEl.className = 'result-item decision-item';
    
    const header = document.createElement('div');
    header.className = 'result-header';
    
    const title = document.createElement('h3');
    title.textContent = item.title;
    
    const score = document.createElement('span');
    score.className = 'result-score';
    score.textContent = `${Math.round(item.score * 100)}%`;
    
    header.appendChild(title);
    header.appendChild(score);
    
    const content = document.createElement('div');
    content.className = 'result-content';
    content.textContent = item.description;
    
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tags-container';
    
    item.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag';
      tagEl.textContent = tag;
      tagsContainer.appendChild(tagEl);
    });
    
    resultEl.appendChild(header);
    resultEl.appendChild(content);
    resultEl.appendChild(tagsContainer);
    
    return resultEl;
  }
  
  function createChatResultElement(item) {
    const resultEl = document.createElement('div');
    resultEl.className = 'result-item chat-item';
    
    const header = document.createElement('div');
    header.className = 'result-header';
    
    const title = document.createElement('h3');
    title.textContent = new Date(item.timestamp).toLocaleString();
    
    const score = document.createElement('span');
    score.className = 'result-score';
    score.textContent = `${Math.round(item.score * 100)}%`;
    
    header.appendChild(title);
    header.appendChild(score);
    
    const content = document.createElement('div');
    content.className = 'result-content';
    content.textContent = item.content;
    
    resultEl.appendChild(header);
    resultEl.appendChild(content);
    
    return resultEl;
  }
  
  // Message handling
  window.addEventListener('message', (event) => {
    const message = event.data;
    
    switch (message.type) {
      case 'searchStarted':
        showLoading();
        break;
      case 'searchResults':
        renderResults(message.results);
        break;
      case 'error':
        // Show error message
        codeResults.innerHTML = `<div class="error">${message.message}</div>`;
        decisionsResults.innerHTML = `<div class="error">${message.message}</div>`;
        chatResults.innerHTML = `<div class="error">${message.message}</div>`;
        break;
    }
  });
})();
