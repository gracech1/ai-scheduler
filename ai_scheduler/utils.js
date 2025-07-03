// Utility functions for scheduling

function minutesBetween(a, b) {
  return Math.floor((b - a) / 60000);
}

function formatTime(dt) {
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseEventTimes(event) {
  return {
    start: new Date(event.start.dateTime),
    end: new Date(event.end.dateTime)
  };
}

export { minutesBetween, formatTime, parseEventTimes }; 