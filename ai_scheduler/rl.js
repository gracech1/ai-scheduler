// Reinforcement Learning module for AI Scheduler - Break Optimization
class SchedulerRL {
  constructor() {
    // Q-learning parameters
    this.qTable = {};           // Stores learned Q-values
    this.learningRate = 0.1;    // How much to update Q-values
    this.discountFactor = 0.9;  // Importance of future rewards
    this.explorationRate = 0.3; // How often to try random actions
    this.minExplorationRate = 0.05; // Minimum exploration rate
    this.explorationDecay = 0.995;  // How fast exploration decreases
    this.episodeCount = 0;      // Number of learning episodes
    
    // Load existing Q-table from storage
    this.loadQTable();
  }

  // State representation: [hour, dayOfWeek, taskCount, avgTaskDuration, hasEvents, mode]
  getState() {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    
    // Get current tasks
    return new Promise((resolve) => {
      chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        const activeTasks = tasks.filter(t => !t.completed);
        const taskCount = activeTasks.length;
        const avgTaskDuration = taskCount > 0 
          ? activeTasks.reduce((sum, t) => sum + t.duration, 0) / taskCount 
          : 0;
        
        // Check if there are calendar events
        const hasEvents = window.todayEvents && window.todayEvents.length > 0;
        
        // Get current mode (pomodoro, eye health, or normal)
        const pomodoroMode = document.getElementById('pomodoro-mode')?.checked || false;
        const eyeHealthMode = document.getElementById('eyehealth-mode')?.checked || false;
        let mode = 0; // normal
        if (pomodoroMode) mode = 1;
        else if (eyeHealthMode) mode = 2;
        
        const state = [hour, dayOfWeek, taskCount, Math.round(avgTaskDuration), hasEvents ? 1 : 0, mode];
        resolve(state);
      });
    });
  }

  // Action space: different break configurations
  getActions() {
    return [
      'short_frequent',    // 5min breaks every 2 tasks
      'short_balanced',    // 10min breaks every 3 tasks  
      'long_balanced',     // 15min breaks every 3 tasks
      'long_infrequent',   // 20min breaks every 4 tasks
      'no_breaks',         // No breaks (work-heavy)
      'adaptive_breaks'    // Varies based on time of day
    ];
  }

  // Get break configuration for an action
  getBreakConfig(action) {
    switch (action) {
      case 'short_frequent':
        return { breakDuration: 5, breakInterval: 2 };
      case 'short_balanced':
        return { breakDuration: 10, breakInterval: 3 };
      case 'long_balanced':
        return { breakDuration: 15, breakInterval: 3 };
      case 'long_infrequent':
        return { breakDuration: 20, breakInterval: 4 };
      case 'no_breaks':
        return { breakDuration: 0, breakInterval: 999 };
      case 'adaptive_breaks':
        return this.getAdaptiveBreakConfig();
      default:
        return { breakDuration: 10, breakInterval: 3 };
    }
  }

  // Get adaptive break configuration based on time of day
  getAdaptiveBreakConfig() {
    const hour = new Date().getHours();
    
    // Morning (high energy): shorter breaks
    if (hour >= 9 && hour <= 11) {
      return { breakDuration: 5, breakInterval: 4 };
    }
    // Afternoon (medium energy): balanced breaks
    else if (hour >= 12 && hour <= 16) {
      return { breakDuration: 15, breakInterval: 3 };
    }
    // Evening (lower energy): longer breaks
    else if (hour >= 17 && hour <= 21) {
      return { breakDuration: 20, breakInterval: 2 };
    }
    // Default
    else {
      return { breakDuration: 10, breakInterval: 3 };
    }
  }

  // Get state-action key for Q-table
  getStateActionKey(state, action) {
    return `${state.join(',')}_${action}`;
  }

  // Q-learning update
  updateQValue(state, action, reward, nextState) {
    const key = this.getStateActionKey(state, action);
    const nextKey = this.getStateActionKey(nextState, this.getBestAction(nextState));
    
    const currentQ = this.qTable[key] || 0;
    const nextQ = this.qTable[nextKey] || 0;
    
    // Q-learning formula: Q(s,a) = Q(s,a) + α[r + γ*max(Q(s',a')) - Q(s,a)]
    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * nextQ - currentQ);
    this.qTable[key] = newQ;
    
    // Save to storage
    this.saveQTable();
  }

  // Choose action using epsilon-greedy strategy
  async chooseAction() {
    const state = await this.getState();
    const actions = this.getActions();
    
    // Exploration vs exploitation
    if (Math.random() < this.explorationRate) {
      // Exploration: choose random action
      return {
        action: actions[Math.floor(Math.random() * actions.length)],
        state: state,
        isExploration: true
      };
    } else {
      // Exploitation: choose best action
      return {
        action: this.getBestAction(state),
        state: state,
        isExploration: false
      };
    }
  }

  // Get best action for a state
  getBestAction(state) {
    const actions = this.getActions();
    let bestAction = actions[0];
    let bestQ = this.qTable[this.getStateActionKey(state, bestAction)] || 0;
    
    for (const action of actions) {
      const qValue = this.qTable[this.getStateActionKey(state, action)] || 0;
      if (qValue > bestQ) {
        bestQ = qValue;
        bestAction = action;
      }
    }
    
    return bestAction;
  }

  // Calculate reward based on user feedback and task completion
  calculateReward(userFeedback, scheduledTasks, completedTasks, unscheduledTasks) {
    let reward = 0;
    
    // User feedback
    if (userFeedback === 'good') reward += 10;
    else if (userFeedback === 'okay') reward += 5;
    else if (userFeedback === 'bad') reward -= 5;
    
    // Task completion rate (most important!)
    if (scheduledTasks.length > 0) {
      const completionRate = completedTasks.length / scheduledTasks.length;
      reward += completionRate * 30;  // Higher weight for completion
    }
    
    // Small penalty for unscheduled tasks
    reward -= unscheduledTasks.length * 1;
    
    return reward;
  }

  // Storage methods
  saveQTable() {
    chrome.storage.local.set({ q_table: this.qTable });
  }

  loadQTable() {
    chrome.storage.local.get(['q_table'], (result) => {
      if (result.q_table) {
        this.qTable = result.q_table;
      }
    });
  }

  // Update exploration rate
  updateExplorationRate() {
    this.explorationRate = Math.max(this.minExplorationRate, this.explorationRate * this.explorationDecay);
  }

  // Get RL statistics
  getStats() {
    return {
      qTableSize: Object.keys(this.qTable).length,
      explorationRate: this.explorationRate,
      episodeCount: this.episodeCount
    };
  }
}

export { SchedulerRL };