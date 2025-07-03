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

function parseEventTimes(event) {
  return {
    start: new Date(event.start.dateTime),
    end: new Date(event.end.dateTime)
  };
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

function minutesBetween(a, b) {
  return Math.floor((b - a) / 60000);
}

function formatTime(dt) {
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
          if (slotMinutes >= task.duration) {
            let taskStart = new Date(slot.start);
            let taskEnd = new Date(taskStart.getTime() + task.duration * 60000);
            // Pomodoro logic for non-splittable tasks
            if (pomodoroMode && task.duration > POMO_WORK) {
              let remaining = task.duration;
              let chunkStart = new Date(taskStart);
              while (remaining > 0) {
                const thisChunk = Math.min(POMO_WORK, remaining);
                const chunkEnd = new Date(chunkStart.getTime() + thisChunk * 60000);
                scheduled.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                pomoCount++;
                remaining -= thisChunk;
                chunkStart = new Date(chunkEnd);
                if (remaining > 0) {
                  // Insert break
                  let breakDuration = (pomoCount % POMO_LONG_BREAK_INTERVAL === 0) ? POMO_LONG_BREAK : POMO_SHORT_BREAK;
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
            if (slotMinutes === task.duration) {
              slots.splice(i, 1);
            } else {
              slot.start = new Date(taskEnd);
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
                chunks.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                pomoCount++;
                slot.start = new Date(chunkEnd);
                remaining -= thisChunk;
                chunkDuration -= thisChunk;
                slotMinutes = minutesBetween(slot.start, slot.end);
                if (remaining > 0 && chunkDuration > 0) {
                  // Insert break
                  let breakDuration = (pomoCount % POMO_LONG_BREAK_INTERVAL === 0) ? POMO_LONG_BREAK : POMO_SHORT_BREAK;
                  const breakStart = new Date(slot.start);
                  const breakEnd = new Date(breakStart.getTime() + breakDuration * 60000);
                  chunks.push({ name: (breakDuration === POMO_LONG_BREAK ? 'Long Pomodoro Break' : 'Pomodoro Break'), start: breakStart, end: breakEnd, duration: breakDuration, isBreak: true });
                  slot.start = new Date(breakEnd);
                  slotMinutes = minutesBetween(slot.start, slot.end);
                }
              }
            } else if (eyeHealthMode) {
              while (chunkDuration > 0 && remaining >= MIN_CHUNK) {
                const thisChunk = Math.min(EYE_WORK, chunkDuration, remaining);
                if (thisChunk < MIN_CHUNK) break;
                const chunkStart = new Date(slot.start);
                const chunkEnd = new Date(chunkStart.getTime() + thisChunk * 60000);
                chunks.push({ ...task, start: chunkStart, end: chunkEnd, chunkDuration: thisChunk });
                slot.start = new Date(chunkEnd);
                remaining -= thisChunk;
                chunkDuration -= thisChunk;
                slotMinutes = minutesBetween(slot.start, slot.end);
                if (remaining > 0 && chunkDuration > 0) {
                  // Insert Eye Health break
                  const breakStart = new Date(slot.start);
                  const breakEnd = new Date(breakStart.getTime() + EYE_BREAK * 60000);
                  chunks.push({ name: 'Eye Health Break', start: breakStart, end: breakEnd, duration: EYE_BREAK, isBreak: true });
                  slot.start = new Date(breakEnd);
                  slotMinutes = minutesBetween(slot.start, slot.end);
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

function displayProposedSchedule(scheduled, unscheduled) {
  const container = document.getElementById('proposed-schedule');
  container.innerHTML = '';
  if (scheduled.length === 0) {
    container.innerHTML = '<p>No tasks could be scheduled for today.</p>';
    return;
  }
  const list = document.createElement('ul');
  scheduled.forEach(item => {
    // Always convert start and end to Date objects from ISO string
    const start = (item.start instanceof Date) ? item.start : new Date(item.start);
    const end = (item.end instanceof Date) ? item.end : new Date(item.end);
    const li = document.createElement('li');
    li.innerHTML = `<strong>${item.name}</strong> <br><small>${formatTime(start)} - ${formatTime(end)} (${item.duration || item.chunkDuration} min)</small>`;
    list.appendChild(li);
  });
  container.appendChild(list);
  if (unscheduled.length > 0) {
    const unsched = document.createElement('div');
    unsched.innerHTML = '<em>Unscheduled tasks:</em> ' + unscheduled.map(t => t.name).join(', ');
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

  // Ensure Pomodoro and Eye Health modes are mutually exclusive
  const pomo = document.getElementById('pomodoro-mode');
  const eye = document.getElementById('eyehealth-mode');
  if (pomo && eye) {
    pomo.addEventListener('change', function() {
      if (pomo.checked) eye.checked = false;
    });
    eye.addEventListener('change', function() {
      if (eye.checked) pomo.checked = false;
    });
  }

  const addToCalBtn = document.getElementById('add-to-calendar-btn');
  if (addToCalBtn) {
    addToCalBtn.addEventListener('click', addScheduleToGoogleCalendar);
  }
}); 