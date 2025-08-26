// logger.js - Centralized logging utility for sending logs to background script

/**
 * Centralized logger that sends all logs to background script
 * @param {string} level - Log level: 'info', 'warn', 'error', 'debug'
 * @param {string} action - The action being performed (e.g., 'FETCH_PROFILE', 'SEND_CONNECTION_REQUEST')
 * @param {string} message - The log message
 * @param {Object} data - Additional data to log (optional)
 * @param {string} source - Source of the log (e.g., 'profile.js', 'topicList.js')
 */
function logToBackground(level, action, message, data = null, source = 'unknown') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    action,
    message,
    source,
    data,
    url: window.location.href
  };

  // Also log to console for immediate visibility
  const consoleMessage = `[${source}][${action}] ${message}`;
  
  switch (level) {
    case 'error':
      console.error(consoleMessage, data);
      break;
    case 'warn':
      console.warn(consoleMessage, data);
      break;
    case 'debug':
      console.debug(consoleMessage, data);
      break;
    case 'success':
      console.log(consoleMessage, data);
      break;
    default:
      console.log(consoleMessage, data);
  }

  // Send to background script
  try {
    chrome.runtime.sendMessage({
      action: 'LOG_TO_BACKGROUND',
      logEntry
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to send log to background:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.warn('Error sending log to background:', error);
  }
}

/**
 * Convenience methods for different log levels
 */
const logger = {
  info: (action, message, data, source) => logToBackground('info', action, message, data, source),
  warn: (action, message, data, source) => logToBackground('warn', action, message, data, source),
  error: (action, message, data, source) => logToBackground('error', action, message, data, source),
  debug: (action, message, data, source) => logToBackground('debug', action, message, data, source),
  success: (action, message, data, source) => {
    // Success logs as info with 🎉 emoji for visibility
    const successMessage = `🎉 ${message}`;
    logToBackground('info', action, successMessage, data, source);
  },

  // Specific action loggers for common operations
  profileAction: {
    start: (message, data) => logger.info('PROFILE_ACTION_START', message, data, 'profile.js'),
    success: (message, data) => logger.success('PROFILE_ACTION_SUCCESS', message, data, 'profile.js'),
    error: (message, data) => logger.error('PROFILE_ACTION_ERROR', message, data, 'profile.js'),
    fetchStart: (message, data) => logger.info('FETCH_PROFILE_START', message, data, 'profile.js'),
    fetchSuccess: (message, data) => logger.success('FETCH_PROFILE_SUCCESS', message, data, 'profile.js'),
    fetchError: (message, data) => logger.error('FETCH_PROFILE_ERROR', message, data, 'profile.js'),
  },

  connectionRequest: {
    start: (message, data) => logger.info('CONNECTION_REQUEST_START', message, data, 'profile.js'),
    success: (message, data) => logger.success('CONNECTION_REQUEST_SUCCESS', message, data, 'profile.js'),
    error: (message, data) => logger.error('CONNECTION_REQUEST_ERROR', message, data, 'profile.js'),
  },

  chatGPT: {
    start: (message, data) => logger.info('CHAT_GPT_START', message, data, 'profile.js'),
    success: (message, data) => logger.success('CHAT_GPT_SUCCESS', message, data, 'profile.js'),
    error: (message, data) => logger.error('CHAT_GPT_ERROR', message, data, 'profile.js'),
  },

  activityAPI: {
    start: (message, data) => logger.info('ACTIVITY_API_START', message, data, 'profile.js'),
    success: (message, data) => logger.success('ACTIVITY_API_SUCCESS', message, data, 'profile.js'),
    error: (message, data) => logger.error('ACTIVITY_API_ERROR', message, data, 'profile.js'),
  },

  profileAnalysis: {
    start: (message, data) => logger.info('PROFILE_ANALYSIS_START', message, data, 'profile.js'),
    success: (message, data) => logger.success('PROFILE_ANALYSIS_SUCCESS', message, data, 'profile.js'),
    error: (message, data) => logger.error('PROFILE_ANALYSIS_ERROR', message, data, 'profile.js'),
  }
};

module.exports = { logger, logToBackground };
