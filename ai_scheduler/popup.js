import { minutesBetween, formatTime, parseEventTimes } from './utils.js';

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
let todayEvents = [];

// Task management functions
function addTask() {
  const taskName = document.getElementById('task-name').value.trim();
  const taskDuration = parseInt(document.getElementById('task-duration').value);
  const taskSplittable = document.getElementById('task-splittable').checked;

  if (!taskName || !taskDuration || taskDuration < 5) {
    alert('Please enter a valid task name and duration (minimum 5 minutes).');
    return;
  }

  const task = {
    id: Date.now(),
    name: taskName,
    duration: taskDuration,
    splittable: taskSplittable,
    completed: false,
    createdAt: new Date().toISOString()
  };

  chrome.storage.local.get(['tasks'], function(result) {
    const tasks = result.tasks || [];
    tasks.push(task);
    chrome.storage.local.set({ tasks: tasks }, function() {
      displayTasks();
      document.getElementById('task-name').value = '';
      document.getElementById('task-duration').value = '';
      document.getElementById('task-splittable').checked = false;
    });
  });
}

function displayTasks() {
  chrome.storage.local.get(['tasks'], function(result) {
    const tasks = result.tasks || [];
    const tasksContainer = document.getElementById('tasks-list');
    
    if (tasks.length === 0) {
      tasksContainer.innerHTML = '<p>No tasks added yet.</p>';
      return;
    }

    const tasksList = document.createElement('ul');
    tasks.forEach((task, idx) => {
      const li = document.createElement('li');
      li.className = 'task-item';
      
      // Arrow controls
      const arrowControls = document.createElement('div');
      arrowControls.style.display = 'flex';
      arrowControls.style.flexDirection = 'column';
      arrowControls.style.marginRight = '8px';
      
      const upBtn = document.createElement('button');
      upBtn.textContent = '↑';
      upBtn.className = 'arrow-btn arrow-up';
      upBtn.disabled = idx === 0;
      upBtn.onclick = () => moveTask(idx, -1);
      
      const downBtn = document.createElement('button');
      downBtn.textContent = '↓';
      downBtn.className = 'arrow-btn arrow-down';
      downBtn.disabled = idx === tasks.length - 1;
      downBtn.onclick = () => moveTask(idx, 1);
      
      arrowControls.appendChild(upBtn);
      arrowControls.appendChild(downBtn);
      
      const taskInfo = document.createElement('div');
      taskInfo.className = 'task-info';
      taskInfo.innerHTML = `
        <strong>${task.name}</strong>
        <br>
        <small>${task.duration} minutes${task.splittable ? ' • Splittable' : ''}</small>
      `;
      
      const taskActions = document.createElement('div');
      taskActions.className = 'task-actions';
      
      const completeBtn = document.createElement('button');
      completeBtn.textContent = task.completed ? '✓' : '○';
      completeBtn.style.backgroundColor = task.completed ? '#4caf50' : '#ccc';
      completeBtn.onclick = () => toggleTaskComplete(task.id);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      deleteBtn.style.backgroundColor = '#f44336';
      deleteBtn.onclick = () => deleteTask(task.id);
      
      taskActions.appendChild(completeBtn);
      taskActions.appendChild(deleteBtn);
      
      li.appendChild(arrowControls);
      li.appendChild(taskInfo);
      li.appendChild(taskActions);
      tasksList.appendChild(li);
    });
    
    tasksContainer.innerHTML = '';
    tasksContainer.appendChild(tasksList);
  });
}

function moveTask(idx, direction) {
  chrome.storage.local.get(['tasks'], function(result) {
    const tasks = result.tasks || [];
    if (
      (direction === -1 && idx === 0) ||
      (direction === 1 && idx === tasks.length - 1)
    ) {
      return;
    }
    const newTasks = [...tasks];
    const temp = newTasks[idx];
    newTasks[idx] = newTasks[idx + direction];
    newTasks[idx + direction] = temp;
    chrome.storage.local.set({ tasks: newTasks }, displayTasks);
  });
}

function toggleTaskComplete(taskId) {
  chrome.storage.local.get(['tasks'], function(result) {
    const tasks = result.tasks || [];
    const updatedTasks = tasks.map(task => 
      task.id === taskId ? { ...task, completed: !task.completed } : task
    );
    chrome.storage.local.set({ tasks: updatedTasks }, displayTasks);
  });
}

function deleteTask(taskId) {
  chrome.storage.local.get(['tasks'], function(result) {
    const tasks = result.tasks || [];
    const updatedTasks = tasks.filter(task => task.id !== taskId);
    chrome.storage.local.set({ tasks: updatedTasks }, displayTasks);
  });
}

function authenticateAndFetchEvents() {
  chrome.identity.getAuthToken({ interactive: true }, function(token) {
    if (chrome.runtime.lastError || !token) {
      alert('Failed to authenticate with Google.');
      return;
    }
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const timeMin = now.toISOString();
    const timeMax = endOfDay.toISOString();
    fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?orderBy=startTime&singleEvents=true&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(response => response.json())
      .then(data => {
        // Only keep events with time blocks and within today
        todayEvents = (data.items || []).filter(event => event.start && event.start.dateTime && event.end && event.end.dateTime);
        const eventsContainer = document.getElementById('calendar-events');
        
        if (todayEvents.length === 0) {
          eventsContainer.innerHTML = '<p>No upcoming timed events for today.</p>';
        } else {
          const eventsList = document.createElement('ul');
          todayEvents.forEach(event => {
            const start = new Date(event.start.dateTime);
            const end = new Date(event.end.dateTime);
            const li = document.createElement('li');
            li.textContent = `${formatTime(start)} - ${formatTime(end)}: ${event.summary}`;
            eventsList.appendChild(li);
          });
          eventsContainer.innerHTML = '';
          eventsContainer.appendChild(eventsList);
        }
      })
      .catch(() => alert('Failed to fetch calendar events.'));
  });
}

// Greedy Scheduling Calendar Plan
function getTodayTimeBounds(customNow) {
  const now = customNow || new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return { now, startOfDay, endOfDay };
}

function findOpenTimeSlots(events, customNow) {
  const { now, endOfDay } = getTodayTimeBounds(customNow);
  const slots = [];
  let lastEnd = now;
  for (const event of events) {
    const { start, end } = parseEventTimes(event);
    if (start > lastEnd) {
      slots.push({ start: new Date(lastEnd), end: new Date(start) });
    }
    if (end > lastEnd) lastEnd = end;
  }
  if (lastEnd < endOfDay) {
    slots.push({ start: new Date(lastEnd), end: new Date(endOfDay) });
  }
  return slots;
}

function getScheduleStorageKey() {
  const timeInput = document.getElementById('schedule-start-time');
  let customNow = new Date();
  if (timeInput && timeInput.value) {
    const [h, m] = timeInput.value.split(':');
    customNow.setHours(parseInt(h), parseInt(m), 0, 0);
  }
  // Use YYYY-MM-DD and HH:MM as key
  const pad = n => n.toString().padStart(2, '0');
  const dateStr = `${customNow.getFullYear()}-${pad(customNow.getMonth() + 1)}-${pad(customNow.getDate())}`;
  const timeStr = `${pad(customNow.getHours())}:${pad(customNow.getMinutes())}`;
  return `schedule_${dateStr}_${timeStr}`;
}

function saveSchedule(scheduled, unscheduled) {
  const key = getScheduleStorageKey();
  // Save the last used time for persistence
  const timeInput = document.getElementById('schedule-start-time');
  if (timeInput && timeInput.value) {
    chrome.storage.local.set({ last_schedule_time: timeInput.value });
  }
  // Convert all start/end fields to ISO strings before saving
  const safeScheduled = scheduled.map(item => ({
    ...item,
    start: (item.start instanceof Date) ? item.start.toISOString() : item.start,
    end: (item.end instanceof Date) ? item.end.toISOString() : item.end
  }));
  const safeUnscheduled = unscheduled.map(item => ({
    ...item,
    start: item.start ? ((item.start instanceof Date) ? item.start.toISOString() : item.start) : undefined,
    end: item.end ? ((item.end instanceof Date) ? item.end.toISOString() : item.end) : undefined
  }));
  chrome.storage.local.set({ [key]: { scheduled: safeScheduled, unscheduled: safeUnscheduled } });
}

function loadScheduleAndDisplay() {
  const key = getScheduleStorageKey();
  chrome.storage.local.get([key], function(result) {
    if (result[key]) {
      displayProposedSchedule(result[key].scheduled, result[key].unscheduled);
    }
  });
}

function clearSchedule() {
  const key = getScheduleStorageKey();
  chrome.storage.local.remove([key], function() {
    displayProposedSchedule([], []);
  });
}

function generateSchedule() {
  // Check which mode is active
  const pomodoroMode = document.getElementById('pomodoro-mode')?.checked;
  const eyeHealthMode = document.getElementById('eyehealth-mode')?.checked;
  const rlMode = document.getElementById('rl-mode')?.checked;
  
  if (rlMode) {
    rlGenerateSchedule();
  } else {
    traditionalGenerateSchedule();
  }
}

function traditionalGenerateSchedule() {
  // Get custom start time from input
  const timeInput = document.getElementById('schedule-start-time');
  let customNow = null;
  if (timeInput && timeInput.value) {
    const [h, m] = timeInput.value.split(':');
    customNow = new Date();
    customNow.setHours(parseInt(h), parseInt(m), 0, 0);
  }
  // Break mode toggles
  const pomodoroMode = document.getElementById('pomodoro-mode')?.checked;
  const eyeHealthMode = document.getElementById('eyehealth-mode')?.checked;
  // Pomodoro Constants
  const POMO_WORK = 25; // minutes
  const POMO_SHORT_BREAK = 5; // minutes
  const POMO_LONG_BREAK = 15; // minutes
  const POMO_LONG_BREAK_INTERVAL = 4;
  // Eye Health Constants
  const EYE_WORK = 20; // minutes
  const EYE_BREAK = 5; // minutes

  chrome.storage.local.get(['tasks'], function(result) {
    const tasks = (result.tasks || []).filter(t => !t.completed);
    const events = todayEvents.slice();
    events.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
    const slots = findOpenTimeSlots(events, customNow);
    const scheduled = [];
    const unscheduled = [];
    const MIN_CHUNK = 5; // minutes
    let pomoCount = 0;
    let slotIdx = 0;
    for (const task of tasks) {
      if (!task.splittable) {
        // Non-splittable: must fit in one slot
        let placed = false;
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          const slotMinutes = minutesBetween(slot.start, slot.end);
          let totalNeeded = task.duration;
          if (pomodoroMode && task.duration > POMO_WORK) {
            // Calculate number of pomodoros and breaks
            const numChunks = Math.ceil(task.duration / POMO_WORK);
            const numBreaks = numChunks - 1;
            let numLongBreaks = 0;
            if (numBreaks > 0) {
              numLongBreaks = Math.floor(numBreaks / POMO_LONG_BREAK_INTERVAL);
            }
            const numShortBreaks = numBreaks - numLongBreaks;
            totalNeeded = task.duration + numShortBreaks * POMO_SHORT_BREAK + numLongBreaks * POMO_LONG_BREAK;
          } else if (eyeHealthMode && task.duration > EYE_WORK) {
            const numChunks = Math.ceil(task.duration / EYE_WORK);
            const numBreaks = numChunks - 1;
            totalNeeded = task.duration + numBreaks * EYE_BREAK;
          }
          if (slotMinutes >= totalNeeded) {
            let taskStart = new Date(slot.start);
            let taskEnd = new Date(taskStart.getTime() + task.duration * 60000);
            // Pomodoro logic for non-splittable tasks
            if (pomodoroMode && task.duration > POMO_WORK) {
              let remaining = task.duration;
              let chunkStart = new Date(taskStart);
              let localPomoCount = 0;
              while (remaining > 0) {
                const thisChunk = Math.min(POMO_WORK, remaining);
                const chunkEnd = new Date(chunkStart.getTime() + thisChunk * 60000);
                scheduled.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                localPomoCount++;
                remaining -= thisChunk;
                chunkStart = new Date(chunkEnd);
                if (remaining > 0) {
                  // Insert break
                  let breakDuration = (localPomoCount % POMO_LONG_BREAK_INTERVAL === 0) ? POMO_LONG_BREAK : POMO_SHORT_BREAK;
                  const breakStart = new Date(chunkStart);
                  const breakEnd = new Date(breakStart.getTime() + breakDuration * 60000);
                  scheduled.push({ name: (breakDuration === POMO_LONG_BREAK ? 'Long Pomodoro Break' : 'Pomodoro Break'), start: breakStart, end: breakEnd, duration: breakDuration, isBreak: true });
                  chunkStart = new Date(breakEnd);
                }
              }
            } else if (eyeHealthMode && task.duration > EYE_WORK) {
              let remaining = task.duration;
              let chunkStart = new Date(taskStart);
              while (remaining > 0) {
                const thisChunk = Math.min(EYE_WORK, remaining);
                const chunkEnd = new Date(chunkStart.getTime() + thisChunk * 60000);
                scheduled.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                remaining -= thisChunk;
                chunkStart = new Date(chunkEnd);
                if (remaining > 0) {
                  // Insert Eye Health break
                  const breakStart = new Date(chunkStart);
                  const breakEnd = new Date(breakStart.getTime() + EYE_BREAK * 60000);
                  scheduled.push({ name: 'Eye Health Break', start: breakStart, end: breakEnd, duration: EYE_BREAK, isBreak: true });
                  chunkStart = new Date(breakEnd);
                }
              }
            } else {
              scheduled.push({ ...task, start: taskStart, end: taskEnd });
            }
            if (slotMinutes === totalNeeded) {
              slots.splice(i, 1);
            } else {
              slot.start = new Date(slot.start.getTime() + totalNeeded * 60000);
            }
            placed = true;
            break;
          }
        }
        if (!placed) unscheduled.push(task);
      } else {
        // Splittable: can be split across multiple slots
        let remaining = task.duration;
        let chunks = [];
        for (let i = 0; i < slots.length && remaining >= MIN_CHUNK; ) {
          const slot = slots[i];
          let slotMinutes = minutesBetween(slot.start, slot.end);
          if (slotMinutes >= MIN_CHUNK) {
            let chunkDuration = Math.min(slotMinutes, remaining);
            // Pomodoro logic for splittable tasks
            if (pomodoroMode) {
              while (chunkDuration > 0 && remaining >= MIN_CHUNK) {
                const thisChunk = Math.min(POMO_WORK, chunkDuration, remaining);
                if (thisChunk < MIN_CHUNK) break;
                const chunkStart = new Date(slot.start);
                const chunkEnd = new Date(chunkStart.getTime() + thisChunk * 60000);
                if (minutesBetween(chunkStart, chunkEnd) > slotMinutes) break;
                chunks.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                pomoCount++;
                slot.start = new Date(chunkEnd);
                remaining -= thisChunk;
                chunkDuration -= thisChunk;
                slotMinutes = minutesBetween(slot.start, slot.end);
                // Only add break if there's time for it in the slot and more task remains
                if (remaining > 0 && chunkDuration > 0) {
                  let breakDuration = (pomoCount % POMO_LONG_BREAK_INTERVAL === 0) ? POMO_LONG_BREAK : POMO_SHORT_BREAK;
                  if (slotMinutes >= breakDuration) {
                    const breakStart = new Date(slot.start);
                    const breakEnd = new Date(breakStart.getTime() + breakDuration * 60000);
                    chunks.push({ name: (breakDuration === POMO_LONG_BREAK ? 'Long Pomodoro Break' : 'Pomodoro Break'), start: breakStart, end: breakEnd, duration: breakDuration, isBreak: true });
                    slot.start = new Date(breakEnd);
                    slotMinutes = minutesBetween(slot.start, slot.end);
                  } else {
                    break;
                  }
                }
              }
            } else if (eyeHealthMode) {
              while (chunkDuration > 0 && remaining >= MIN_CHUNK) {
                const thisChunk = Math.min(EYE_WORK, chunkDuration, remaining);
                if (thisChunk < MIN_CHUNK) break;
                const chunkStart = new Date(slot.start);
                const chunkEnd = new Date(chunkStart.getTime() + thisChunk * 60000);
                if (minutesBetween(chunkStart, chunkEnd) > slotMinutes) break;
                chunks.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                slot.start = new Date(chunkEnd);
                remaining -= thisChunk;
                chunkDuration -= thisChunk;
                slotMinutes = minutesBetween(slot.start, slot.end);
                // Only add break if there's time for it in the slot and more task remains
                if (remaining > 0 && chunkDuration > 0) {
                  if (slotMinutes >= EYE_BREAK) {
                    const breakStart = new Date(slot.start);
                    const breakEnd = new Date(breakStart.getTime() + EYE_BREAK * 60000);
                    chunks.push({ name: 'Eye Health Break', start: breakStart, end: breakEnd, duration: EYE_BREAK, isBreak: true });
                    slot.start = new Date(breakEnd);
                    slotMinutes = minutesBetween(slot.start, slot.end);
                  } else {
                    break;
                  }
                }
              }
            } else {
              const chunkStart = new Date(slot.start);
              const chunkEnd = new Date(chunkStart.getTime() + chunkDuration * 60000);
              chunks.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration });
              slot.start = new Date(chunkEnd);
              remaining -= chunkDuration;
            }
            if (minutesBetween(slot.start, slot.end) < MIN_CHUNK) {
              slots.splice(i, 1);
            } else {
              i++;
            }
          } else {
            i++;
          }
        }
        if (chunks.length > 0) {
          scheduled.push(...chunks);
        }
        if (remaining > 0) {
          unscheduled.push({ ...task, duration: remaining });
        }
      }
    }
    displayProposedSchedule(scheduled, unscheduled);
    saveSchedule(scheduled, unscheduled);
  });
}

async function rlGenerateSchedule() {
  // Import RL agent dynamically when needed
  const { SchedulerRL } = await import('./rl.js');
  const rlAgent = new SchedulerRL();
  
  // Get custom start time from input
  const timeInput = document.getElementById('schedule-start-time');
  let customNow = null;
  if (timeInput && timeInput.value) {
    const [h, m] = timeInput.value.split(':');
    customNow = new Date();
    customNow.setHours(parseInt(h), parseInt(m), 0, 0);
  }
  
  try {
    // Get RL action (break strategy)
    const actionResult = await rlAgent.chooseAction();
    const { action, state, isExploration } = actionResult;
    
    console.log(`RL Agent chose action: ${action} (exploration: ${isExploration})`);
    
    // Store the chosen action for later reward calculation
    window.lastRLState = state;
    window.lastRLAction = action;
    
    // Get break configuration from RL agent
    const breakConfig = rlAgent.getBreakConfig(action);
    
    // Use RL scheduling logic here
    chrome.storage.local.get(['tasks'], function(result) {
      const tasks = (result.tasks || []).filter(t => !t.completed);
      const events = todayEvents.slice();
      events.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
      const slots = findOpenTimeSlots(events, customNow);
      const scheduled = [];
      const unscheduled = [];
      
      // RL scheduling logic with proper splittable task handling
      let consecutiveTasks = 0;
      const MIN_CHUNK = 5; // minimum chunk size in minutes
      
      for (const task of tasks) {
        if (!task.splittable) {
          // Non-splittable: must fit in one slot
          let placed = false;
          
          for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const slotMinutes = minutesBetween(slot.start, slot.end);
            
            // Check if we need to add a break before this task
            if (breakConfig.breakDuration > 0 && consecutiveTasks >= breakConfig.breakInterval) {
              if (slotMinutes >= breakConfig.breakDuration + task.duration) {
                // Add break first
                const breakStart = new Date(slot.start);
                const breakEnd = new Date(breakStart.getTime() + breakConfig.breakDuration * 60000);
                scheduled.push({ 
                  name: `AI Break (${breakConfig.breakDuration}min)`, 
                  start: breakStart, 
                  end: breakEnd, 
                  duration: breakConfig.breakDuration, 
                  isBreak: true 
                });
                
                // Then add the task
                const taskStart = new Date(breakEnd);
                const taskEnd = new Date(taskStart.getTime() + task.duration * 60000);
                scheduled.push({ ...task, start: taskStart, end: taskEnd });
                consecutiveTasks = 1; // Reset to 1 since we just added a task
                
                // Update slot
                slot.start = new Date(taskEnd);
                if (minutesBetween(slot.start, slot.end) < MIN_CHUNK) {
                  slots.splice(i, 1);
                }
                placed = true;
                break;
              }
            } else if (slotMinutes >= task.duration) {
              // No break needed, just add the task
              const taskStart = new Date(slot.start);
              const taskEnd = new Date(taskStart.getTime() + task.duration * 60000);
              scheduled.push({ ...task, start: taskStart, end: taskEnd });
              consecutiveTasks++;
              
              // Update slot
              slot.start = new Date(taskEnd);
              if (minutesBetween(slot.start, slot.end) < MIN_CHUNK) {
                slots.splice(i, 1);
              }
              placed = true;
              break;
            }
          }
          if (!placed) unscheduled.push(task);
        } else {
          // Splittable: can be split across multiple slots
          let remaining = task.duration;
          let chunks = [];
          let slotIdx = 0;
          
          while (remaining >= MIN_CHUNK && slotIdx < slots.length) {
            const slot = slots[slotIdx];
            let slotMinutes = minutesBetween(slot.start, slot.end);
            
            if (slotMinutes >= MIN_CHUNK) {
              // Check if we need to add a break
              if (breakConfig.breakDuration > 0 && consecutiveTasks >= breakConfig.breakInterval) {
                if (slotMinutes >= breakConfig.breakDuration + MIN_CHUNK) {
                  // Add break first
                  const breakStart = new Date(slot.start);
                  const breakEnd = new Date(breakStart.getTime() + breakConfig.breakDuration * 60000);
                  chunks.push({ 
                    name: `AI Break (${breakConfig.breakDuration}min)`, 
                    start: breakStart, 
                    end: breakEnd, 
                    duration: breakConfig.breakDuration, 
                    isBreak: true 
                  });
                  slot.start = new Date(breakEnd);
                  slotMinutes = minutesBetween(slot.start, slot.end);
                  consecutiveTasks = 0;
                }
              }
              
              // Now add task chunk
              let chunkDuration = Math.min(slotMinutes, remaining);
              if (chunkDuration >= MIN_CHUNK) {
                const chunkStart = new Date(slot.start);
                const chunkEnd = new Date(chunkStart.getTime() + chunkDuration * 60000);
                chunks.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration });
                consecutiveTasks++;
                slot.start = new Date(chunkEnd);
                remaining -= chunkDuration;
              }
            }
            
            // Check if slot is still usable
            if (minutesBetween(slot.start, slot.end) < MIN_CHUNK) {
              slots.splice(slotIdx, 1);
            } else {
              slotIdx++;
            }
          }
          
          if (chunks.length > 0) {
            scheduled.push(...chunks);
          }
          if (remaining > 0) {
            unscheduled.push({ ...task, duration: remaining });
          }
        }
      }
      
      // Sort scheduled items by start time before displaying
      scheduled.sort((a, b) => {
        const startA = (a.start instanceof Date) ? a.start : new Date(a.start);
        const startB = (b.start instanceof Date) ? b.start : new Date(b.start);
        return startA.getTime() - startB.getTime();
      });
      
      displayProposedSchedule(scheduled, unscheduled);
      saveSchedule(scheduled, unscheduled);
      
      // Show RL info to user
      showRLInfo(action, isExploration);
    });
    
  } catch (error) {
    console.error('RL scheduling failed:', error);
    // Fallback to traditional scheduling
    traditionalGenerateSchedule();
  }
}

// Helper function to find break slot
function findBreakSlot(slots) {
  for (let i = 0; i < slots.length; i++) {
    if (minutesBetween(slots[i].start, slots[i].end) >= 15) {
      return slots[i];
    }
  }
  return null;
}

function displayProposedSchedule(scheduled, unscheduled) {
  const container = document.getElementById('proposed-schedule');
  container.innerHTML = '';
  
  // Combine scheduled tasks with calendar events
  const allItems = [];
  
  // Add scheduled tasks
  if (scheduled.length > 0) {
    allItems.push(...scheduled.map(item => ({ ...item, type: 'scheduled' })));
  }
  
  // Add calendar events
  if (todayEvents && todayEvents.length > 0) {
    const calendarItems = todayEvents.map(event => {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      const duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
      return {
        name: event.summary,
        start: start,
        end: end,
        duration: duration,
        type: 'calendar',
        isBreak: false
      };
    });
    allItems.push(...calendarItems);
  }
  
  if (allItems.length === 0) {
    container.innerHTML = '<p>No tasks or events scheduled for today.</p>';
    return;
  }
  
  // Sort all items by start time
  allItems.sort((a, b) => {
    const startA = (a.start instanceof Date) ? a.start : new Date(a.start);
    const startB = (b.start instanceof Date) ? b.start : new Date(b.start);
    return startA.getTime() - startB.getTime();
  });
  
  const list = document.createElement('ul');
  allItems.forEach(item => {
    // Always convert start and end to Date objects from ISO string
    const start = (item.start instanceof Date) ? item.start : new Date(item.start);
    const end = (item.end instanceof Date) ? item.end : new Date(item.end);
    
    // Calculate actual duration in minutes
    const actualDuration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    
    const li = document.createElement('li');
    li.className = 'schedule-item';
    
    // Apply different styling based on item type
    if (item.type === 'calendar') {
      li.classList.add('calendar');
      li.innerHTML = `<strong>📅 ${item.name}</strong> <br><small>${formatTime(start)} - ${formatTime(end)} (${actualDuration} min)</small>`;
    } else if (item.isBreak) {
      li.classList.add('break');
      li.innerHTML = `<strong>☕ ${item.name}</strong> <br><small>${formatTime(start)} - ${formatTime(end)} (${actualDuration} min)</small>`;
    } else {
      li.classList.add('task');
      li.innerHTML = `<strong>📝 ${item.name}</strong> <br><small>${formatTime(start)} - ${formatTime(end)} (${actualDuration} min)</small>`;
    }
    
    list.appendChild(li);
  });
  container.appendChild(list);
  
  if (unscheduled.length > 0) {
    const unsched = document.createElement('div');
    unsched.className = 'unscheduled-tasks';
    unsched.innerHTML = '<em>❌ Unscheduled tasks:</em> ' + unscheduled.map(t => t.name).join(', ');
    container.appendChild(unsched);
  }
}

async function addScheduleToGoogleCalendar() {
  // Get the current proposed schedule from storage
  const key = getScheduleStorageKey();
  chrome.storage.local.get([key], async function(result) {
    if (!result[key] || !result[key].scheduled || result[key].scheduled.length === 0) {
      alert('No schedule to add. Please generate a schedule first.');
      return;
    }
    // Get Google OAuth token
    chrome.identity.getAuthToken({ interactive: true }, async function(token) {
      if (!token) {
        alert('Failed to authenticate with Google.');
        return;
      }
      let successCount = 0;
      let failCount = 0;
      for (const item of result[key].scheduled) {
        // Prepare event details
        const isBreak = item.isBreak;
        const event = {
          summary: isBreak ? `🟦 ${item.name}` : item.name,
          start: { dateTime: (item.start instanceof Date) ? item.start.toISOString() : item.start },
          end: { dateTime: (item.end instanceof Date) ? item.end.toISOString() : item.end },
          colorId: isBreak ? '8' : undefined,
        };
        try {
          const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
          });
          if (response.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }
      alert(`Added ${successCount} events to Google Calendar.${failCount > 0 ? ' Failed to add ' + failCount + ' events.' : ''}`);
    });
  });
}

// Show RL information to user
function showRLInfo(action, isExploration) {
  const actionNames = {
    'short_frequent': 'Short Frequent Breaks (5min every 2 tasks)',
    'short_balanced': 'Short Balanced Breaks (10min every 3 tasks)',
    'long_balanced': 'Long Balanced Breaks (15min every 3 tasks)',
    'long_infrequent': 'Long Infrequent Breaks (20min every 4 tasks)',
    'no_breaks': 'No Breaks (Work-Heavy)',
    'adaptive_breaks': 'Adaptive Breaks (Time-Based)'
  };
  
  // Update the HTML elements
  document.getElementById('rl-strategy').textContent = `Strategy: ${actionNames[action] || action}`;
  document.getElementById('rl-mode-indicator').textContent = `Mode: ${isExploration ? '🔍 Exploring' : '🎯 Exploiting'}`;
  
  // Show the feedback section
  document.getElementById('rl-feedback-section').style.display = 'block';
  
  // Hide any previous feedback message
  document.getElementById('feedback-message').style.display = 'none';
}

// Handle user feedback and update RL model
async function provideFeedback(feedback) {
  try {
    const { SchedulerRL } = await import('./rl.js');
    const rlAgent = new SchedulerRL();
    
    // Get current schedule from storage
    const key = getScheduleStorageKey();
    chrome.storage.local.get([key], async function(result) {
      if (!result[key]) return;
      
      const scheduledTasks = result[key].scheduled || [];
      const unscheduledTasks = result[key].unscheduled || [];
      
      // Get completed tasks (you'll need to implement task completion tracking)
      const completedTasks = await getCompletedTasks(scheduledTasks);
      
      // Calculate reward
      const reward = rlAgent.calculateReward(feedback, scheduledTasks, completedTasks, unscheduledTasks);
      
      // Get next state (current state after this schedule)
      const nextState = await rlAgent.getState();
      
      // Update Q-value
      if (window.lastRLState && window.lastRLAction) {
        rlAgent.updateQValue(window.lastRLState, window.lastRLAction, reward, nextState);
        rlAgent.updateExplorationRate();
        rlAgent.episodeCount++;
        
        console.log(`RL Update: Reward=${reward}, Episode=${rlAgent.episodeCount}`);
        
        // Show feedback confirmation using HTML element
        const feedbackMsg = document.getElementById('feedback-message');
        feedbackMsg.textContent = 'Thank you for your feedback! The AI is learning...';
        feedbackMsg.style.color = feedback === 'good' ? '#4caf50' : feedback === 'okay' ? '#ff9800' : '#f44336';
        feedbackMsg.style.display = 'block';
        
        // Hide feedback buttons after 2 seconds
        setTimeout(() => {
          document.getElementById('rl-feedback-section').style.display = 'none';
        }, 2000);
      }
    });
  } catch (error) {
    console.error('Error providing feedback:', error);
  }
}

// Display RL statistics
async function displayRLStats() {
  try {
    const { SchedulerRL } = await import('./rl.js');
    const rlAgent = new SchedulerRL();
    const stats = rlAgent.getStats();
    
    // Update the HTML elements
    document.getElementById('episode-count').textContent = stats.episodeCount;
    document.getElementById('qtable-size').textContent = stats.qTableSize;
    document.getElementById('exploration-rate').textContent = (stats.explorationRate * 100).toFixed(1);
    
    // Show the section if RL mode is enabled
    const rlMode = document.getElementById('rl-mode')?.checked;
    const statsSection = document.getElementById('rl-stats-section');
    if (rlMode) {
      statsSection.style.display = 'block';
    }
  } catch (error) {
    console.error('Error displaying RL stats:', error);
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('auth-btn').addEventListener('click', authenticateAndFetchEvents);
  document.getElementById('add-task-btn').addEventListener('click', addTask);
  document.getElementById('generate-schedule-btn').addEventListener('click', generateSchedule);
  displayTasks();

  // Try to get a Google auth token non-interactively
  chrome.identity.getAuthToken({ interactive: false }, function(token) {
    if (token) {
      authenticateAndFetchEvents();
    }
  });

  // Set default time input to current time
  const timeInput = document.getElementById('schedule-start-time');
  if (timeInput) {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    timeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    // Load persisted schedule for this time
    timeInput.addEventListener('change', loadScheduleAndDisplay);
    loadScheduleAndDisplay();
  }

  // Ensure Pomodoro, Eye Health, and RL modes are mutually exclusive
  const pomo = document.getElementById('pomodoro-mode');
  const eye = document.getElementById('eyehealth-mode');
  const rl = document.getElementById('rl-mode');
  if (pomo && eye && rl) {
    pomo.addEventListener('change', function() {
      if (pomo.checked) {
        eye.checked = false;
        rl.checked = false;
        document.getElementById('rl-stats-section').style.display = 'none';
        document.getElementById('rl-feedback-section').style.display = 'none';
      }
    });
    eye.addEventListener('change', function() {
      if (eye.checked) {
        pomo.checked = false;
        rl.checked = false;
        document.getElementById('rl-stats-section').style.display = 'none';
        document.getElementById('rl-feedback-section').style.display = 'none';
      }
    });
    rl.addEventListener('change', function() {
      if (rl.checked) {
        pomo.checked = false;
        eye.checked = false;
        displayRLStats();
      } else {
        document.getElementById('rl-stats-section').style.display = 'none';
        document.getElementById('rl-feedback-section').style.display = 'none';
      }
    });
  }

  const addToCalBtn = document.getElementById('add-to-calendar-btn');
  if (addToCalBtn) {
    addToCalBtn.addEventListener('click', addScheduleToGoogleCalendar);
  }

  // Add reset RL button event listener
  const resetRLBtn = document.getElementById('reset-rl-btn');
  if (resetRLBtn) {
    resetRLBtn.addEventListener('click', resetRLLearning);
  }

  // Add feedback button event listeners
  const feedbackGood = document.getElementById('feedback-good');
  const feedbackOkay = document.getElementById('feedback-okay');
  const feedbackBad = document.getElementById('feedback-bad');
  
  if (feedbackGood) feedbackGood.addEventListener('click', () => provideFeedback('good'));
  if (feedbackOkay) feedbackOkay.addEventListener('click', () => provideFeedback('okay'));
  if (feedbackBad) feedbackBad.addEventListener('click', () => provideFeedback('bad'));

  // On popup load, set the time input to the last used time if available
  chrome.storage.local.get(['last_schedule_time'], function(result) {
    if (result.last_schedule_time) {
      timeInput.value = result.last_schedule_time;
    }
    // Now load the schedule for this time
    loadScheduleAndDisplay();
  });
}); 