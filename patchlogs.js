// Redirect console.log to console.error for better Docker logging
const originalConsoleLog = console.log;
console.log = function() {
  originalConsoleLog.apply(console, arguments);
  console.error.apply(console, arguments);
};
