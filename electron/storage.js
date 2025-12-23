const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ElectronStorage {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.storagePath = path.join(this.userDataPath, 'agentrooms-data');
    
    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  // Agent Settings Storage
  saveAgentConfig(config) {
    const filePath = path.join(this.storagePath, 'agent-config.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Failed to save agent config:', error);
      return { success: false, error: error.message };
    }
  }

  loadAgentConfig() {
    const filePath = path.join(this.storagePath, 'agent-config.json');
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return { success: true, data: JSON.parse(data) };
      }
      return { success: true, data: null };
    } catch (error) {
      console.error('Failed to load agent config:', error);
      return { success: false, error: error.message };
    }
  }

  // Chat Messages Storage
  saveConversation(sessionId, messages) {
    const conversationsDir = path.join(this.storagePath, 'conversations');
    if (!fs.existsSync(conversationsDir)) {
      fs.mkdirSync(conversationsDir, { recursive: true });
    }
    
    const filePath = path.join(conversationsDir, `${sessionId}.json`);
    try {
      const conversationData = {
        sessionId,
        messages,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(conversationData, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Failed to save conversation:', error);
      return { success: false, error: error.message };
    }
  }

  loadConversation(sessionId) {
    const filePath = path.join(this.storagePath, 'conversations', `${sessionId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return { success: true, data: JSON.parse(data) };
      }
      return { success: true, data: null };
    } catch (error) {
      console.error('Failed to load conversation:', error);
      return { success: false, error: error.message };
    }
  }

  listConversations() {
    const conversationsDir = path.join(this.storagePath, 'conversations');
    try {
      if (!fs.existsSync(conversationsDir)) {
        return { success: true, data: [] };
      }
      
      const files = fs.readdirSync(conversationsDir);
      const conversations = files
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const sessionId = file.replace('.json', '');
          const filePath = path.join(conversationsDir, file);
          const stats = fs.statSync(filePath);
          
          try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
              sessionId,
              lastUpdated: data.lastUpdated || stats.mtime.toISOString(),
              messageCount: data.messages?.length || 0
            };
          } catch (error) {
            return {
              sessionId,
              lastUpdated: stats.mtime.toISOString(),
              messageCount: 0,
              error: 'Failed to parse conversation'
            };
          }
        })
        .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
      
      return { success: true, data: conversations };
    } catch (error) {
      console.error('Failed to list conversations:', error);
      return { success: false, error: error.message };
    }
  }

  // App Settings Storage
  saveSetting(key, value) {
    const filePath = path.join(this.storagePath, 'app-settings.json');
    let settings = {};
    
    try {
      if (fs.existsSync(filePath)) {
        settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
      
      settings[key] = value;
      settings.lastUpdated = new Date().toISOString();
      
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Failed to save setting:', error);
      return { success: false, error: error.message };
    }
  }

  loadSetting(key) {
    const filePath = path.join(this.storagePath, 'app-settings.json');
    try {
      if (fs.existsSync(filePath)) {
        const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { success: true, data: settings[key] };
      }
      return { success: true, data: null };
    } catch (error) {
      console.error('Failed to load setting:', error);
      return { success: false, error: error.message };
    }
  }

  loadAllSettings() {
    const filePath = path.join(this.storagePath, 'app-settings.json');
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return { success: true, data: JSON.parse(data) };
      }
      return { success: true, data: {} };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Task Queue Storage
  // ============================================

  /**
   * Get the task queues directory path
   */
  getQueuesDir() {
    const queuesDir = path.join(this.storagePath, 'task-queues');
    if (!fs.existsSync(queuesDir)) {
      fs.mkdirSync(queuesDir, { recursive: true });
    }
    return queuesDir;
  }

  /**
   * Save a task queue to storage
   * @param {string} queueId - The queue ID
   * @param {object} queue - The queue data
   */
  saveTaskQueue(queueId, queue) {
    const filePath = path.join(this.getQueuesDir(), `${queueId}.json`);
    try {
      const queueData = {
        ...queue,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(queueData, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Failed to save task queue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Load a task queue from storage
   * @param {string} queueId - The queue ID
   */
  loadTaskQueue(queueId) {
    const filePath = path.join(this.getQueuesDir(), `${queueId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return { success: true, data: JSON.parse(data) };
      }
      return { success: true, data: null };
    } catch (error) {
      console.error('Failed to load task queue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a task queue from storage
   * @param {string} queueId - The queue ID
   */
  deleteTaskQueue(queueId) {
    const filePath = path.join(this.getQueuesDir(), `${queueId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to delete task queue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * List all task queues
   * Returns summary info for each queue (not full task data)
   */
  listTaskQueues() {
    const queuesDir = this.getQueuesDir();
    try {
      const files = fs.readdirSync(queuesDir);
      const queues = files
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(queuesDir, file);
          try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
              id: data.id,
              name: data.name,
              status: data.status,
              taskCount: data.tasks?.length || 0,
              completedCount: data.metrics?.completedTasks || 0,
              failedCount: data.metrics?.failedTasks || 0,
              createdAt: data.createdAt,
              lastUpdated: data.lastUpdated
            };
          } catch (parseError) {
            console.error(`Failed to parse queue file ${file}:`, parseError);
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      return { success: true, data: queues };
    } catch (error) {
      console.error('Failed to list task queues:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Load all queues that were running or paused (for resume on app start)
   */
  loadInterruptedQueues() {
    const queuesDir = this.getQueuesDir();
    try {
      const files = fs.readdirSync(queuesDir);
      const interruptedQueues = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(queuesDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          // Only return queues that were running or paused
          if (data.status === 'running' || data.status === 'paused') {
            interruptedQueues.push(data);
          }
        } catch (parseError) {
          console.error(`Failed to parse queue file ${file}:`, parseError);
        }
      }

      return { success: true, data: interruptedQueues };
    } catch (error) {
      console.error('Failed to load interrupted queues:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ElectronStorage;