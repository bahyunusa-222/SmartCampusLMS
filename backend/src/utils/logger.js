const write = (level, message, fields = {}) => {
    const record = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...fields
    };
    const output = JSON.stringify(record);
    if (level === "error") console.error(output);
    else if (level === "warn") console.warn(output);
    else console.log(output);
};

module.exports = {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
};
