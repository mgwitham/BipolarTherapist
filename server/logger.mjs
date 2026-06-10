function write(level, msg, ctx) {
  const entry = { level, msg, ...ctx, time: new Date().toISOString() };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (msg, ctx = {}) => write("info", msg, ctx),
  warn: (msg, ctx = {}) => write("warn", msg, ctx),
  error: (msg, ctx = {}) => write("error", msg, ctx),
};
