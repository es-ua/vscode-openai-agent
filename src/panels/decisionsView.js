(function() {
  const vscode = acquireVsCodeApi();
  
  // DOM Elements
  const decisionsList = document.getElementById('decisions-list');
  const refreshBtn = document.getElementById('refresh-btn');
  const addBtn = document.getElementById('add-btn');
  const searchInput = document.getElementById('search');
  const searchBtn = document.getElementById('search-btn');
  const modal = document.getElementById('add-modal');
  const closeModal = document.getElementById('close-modal');
  const saveDecisionBtn = document.getElementById('save-decision');
  
  // Decision form elements
  const titleInput = document.getElementById('decision-title');
  const descriptionInput = document.getElementById('decision-description');
  const reasoningInput = document.getElementById('decision-reasoning');
  const tagsInput = document.getElementById('decision-tags');
  
  // Event listeners
  refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
    decisionsList.innerHTML = '<div class="loading">Loading decisions...</div>';
  });
  
  addBtn.addEventListener('click', () => {
    modal.style.display = 'block';
  });
  
  closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });
  
  searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
      vscode.postMessage({ type: 'searchDecisions', query });
      decisionsList.innerHTML = '<div class="loading">Searching...</div>';
    } else {
      vscode.postMessage({ type: 'refresh' });
    }
  });
  
  searchInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      searchBtn.click();
    }
  });
  
  saveDecisionBtn.addEventListener('click', () => {
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const reasoning = reasoningInput.value.trim();
    const tags = tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag);
    
    if (!title) {
      showError('Title is required');
      return;
    }
    
    if (!description) {
      showError('Description is required');
      return;
    }
    
    vscode.postMessage({
      type: 'addDecision',
      decision: {
        title,
        description,
        reasoning,
        tags
      }
    });
    
    modal.style.display = 'none';
    clearForm();
  });
  
  // Message handling
  window.addEventListener('message', (event) => {
    const message = event.data;
    
    switch (message.type) {
      case 'decisionsLoaded':
        renderDecisions(message.decisions);
        break;
      case 'searchResults':
        renderDecisions(message.decisions);
        break;
      case 'decisionAdded':
        if (message.success) {
          showNotification('Decision added successfully');
        }
        break;
      case 'error':
        showError(message.message);
        break;
    }
  });
  
  // Helper functions
  function renderDecisions(decisions) {
    if (!decisions || decisions.length === 0) {
      decisionsList.innerHTML = '<div class="empty-state">No decisions found</div>';
      return;
    }
    
    decisionsList.innerHTML = '';
    
    decisions.forEach(decision => {
      const decisionEl = document.createElement('div');
      decisionEl.className = 'decision-item';
      
      const header = document.createElement('div');
      header.className = 'decision-header';
      
      const title = document.createElement('h3');
      title.textContent = decision.title;
      
      const date = document.createElement('span');
      date.className = 'decision-date';
      date.textContent = new Date(decision.timestamp).toLocaleDateString();
      
      header.appendChild(title);
      header.appendChild(date);
      
      const description = document.createElement('div');
      description.className = 'decision-description';
      description.textContent = decision.description;
      
      const tagsContainer = document.createElement('div');
      tagsContainer.className = 'decision-tags';
      
      decision.tags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag';
        tagEl.textContent = tag;
        tagsContainer.appendChild(tagEl);
      });
      
      decisionEl.appendChild(header);
      decisionEl.appendChild(description);
      decisionEl.appendChild(tagsContainer);
      
      // Show reasoning on click
      decisionEl.addEventListener('click', () => {
        const existingReasoning = decisionEl.querySelector('.decision-reasoning');
        
        if (existingReasoning) {
          existingReasoning.remove();
          decisionEl.classList.remove('expanded');
        } else {
          const reasoningEl = document.createElement('div');
          reasoningEl.className = 'decision-reasoning';
          
          const reasoningTitle = document.createElement('h4');
          reasoningTitle.textContent = 'Reasoning:';
          
          const reasoningText = document.createElement('p');
          reasoningText.textContent = decision.reasoning || 'No reasoning provided';
          
          reasoningEl.appendChild(reasoningTitle);
          reasoningEl.appendChild(reasoningText);
          
          decisionEl.appendChild(reasoningEl);
          decisionEl.classList.add('expanded');
        }
      });
      
      decisionsList.appendChild(decisionEl);
    });
  }
  
  function clearForm() {
    titleInput.value = '';
    descriptionInput.value = '';
    reasoningInput.value = '';
    tagsInput.value = '';
  }
  
  function showError(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'error-notification';
    errorEl.textContent = message;
    
    document.body.appendChild(errorEl);
    
    setTimeout(() => {
      errorEl.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      errorEl.classList.remove('show');
      setTimeout(() => {
        errorEl.remove();
      }, 300);
    }, 3000);
  }
  
  function showNotification(message) {
    const notificationEl = document.createElement('div');
    notificationEl.className = 'success-notification';
    notificationEl.textContent = message;
    
    document.body.appendChild(notificationEl);
    
    setTimeout(() => {
      notificationEl.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      notificationEl.classList.remove('show');
      setTimeout(() => {
        notificationEl.remove();
      }, 300);
    }, 3000);
  }
  
  // Initial load
  vscode.postMessage({ type: 'refresh' });
})();
