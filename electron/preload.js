const { contextBridge, ipcRenderer } = require('electron');

// Validate URL to prevent security issues
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

// Validate input parameters to prevent injection attacks
function validateString(input, maxLength = 1000) {
  return typeof input === 'string' && input.length <= maxLength;
}

function validateObject(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform information (read-only)
  platform: process.platform,
  
  // External URL handler with validation
  openExternal: (url) => {
    if (!isValidUrl(url)) {
      console.error('Invalid URL provided to openExternal:', url);
      return Promise.reject(new Error('Invalid URL'));
    }
    return ipcRenderer.invoke('open-external', url);
  },

  // Authentication API
  auth: {
    startOAuth: () => ipcRenderer.invoke('auth:start-oauth'),
    completeOAuth: (authCode) => ipcRenderer.invoke('auth:complete-oauth', authCode),
    checkStatus: () => ipcRenderer.invoke('auth:check-status'),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
  },

  // Persistent Storage API with validation
  storage: {
    // Agent Configuration
    saveAgentConfig: (config) => {
      if (!validateObject(config)) {
        return Promise.reject(new Error('Invalid config object'));
      }
      return ipcRenderer.invoke('storage:save-agent-config', config);
    },
    loadAgentConfig: () => ipcRenderer.invoke('storage:load-agent-config'),
    
    // Chat Messages  
    saveConversation: (sessionId, messages) => {
      if (!validateString(sessionId, 100) || !Array.isArray(messages)) {
        return Promise.reject(new Error('Invalid conversation parameters'));
      }
      // Limit message array size to prevent memory issues
      if (messages.length > 1000) {
        return Promise.reject(new Error('Too many messages'));
      }
      return ipcRenderer.invoke('storage:save-conversation', sessionId, messages);
    },
    loadConversation: (sessionId) => {
      if (!validateString(sessionId, 100)) {
        return Promise.reject(new Error('Invalid session ID'));
      }
      return ipcRenderer.invoke('storage:load-conversation', sessionId);
    },
    listConversations: () => ipcRenderer.invoke('storage:list-conversations'),
    
    // App Settings
    saveSetting: (key, value) => {
      if (!validateString(key, 50)) {
        return Promise.reject(new Error('Invalid setting key'));
      }
      // Allow various value types but with size limits
      if (typeof value === 'string' && value.length > 10000) {
        return Promise.reject(new Error('Setting value too large'));
      }
      return ipcRenderer.invoke('storage:save-setting', key, value);
    },
    loadSetting: (key) => {
      if (!validateString(key, 50)) {
        return Promise.reject(new Error('Invalid setting key'));
      }
      return ipcRenderer.invoke('storage:load-setting', key);
    },
    loadAllSettings: () => ipcRenderer.invoke('storage:load-all-settings'),

    // Task Queue Storage
    saveTaskQueue: (queueId, queue) => {
      if (!validateString(queueId, 100)) {
        return Promise.reject(new Error('Invalid queue ID'));
      }
      if (!validateObject(queue)) {
        return Promise.reject(new Error('Invalid queue object'));
      }
      // Limit tasks array size
      if (queue.tasks && queue.tasks.length > 100) {
        return Promise.reject(new Error('Too many tasks in queue'));
      }
      return ipcRenderer.invoke('storage:save-task-queue', queueId, queue);
    },
    loadTaskQueue: (queueId) => {
      if (!validateString(queueId, 100)) {
        return Promise.reject(new Error('Invalid queue ID'));
      }
      return ipcRenderer.invoke('storage:load-task-queue', queueId);
    },
    deleteTaskQueue: (queueId) => {
      if (!validateString(queueId, 100)) {
        return Promise.reject(new Error('Invalid queue ID'));
      }
      return ipcRenderer.invoke('storage:delete-task-queue', queueId);
    },
    listTaskQueues: () => ipcRenderer.invoke('storage:list-task-queues'),
    loadInterruptedQueues: () => ipcRenderer.invoke('storage:load-interrupted-queues')
  }
});

// Log when preload script loads
console.log('AgentHub preload script loaded');