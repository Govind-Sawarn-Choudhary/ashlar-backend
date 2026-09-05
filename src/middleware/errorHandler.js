function isForeignKeyError(err) {
  return (
    err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
    || String(err?.message || '').includes('FOREIGN KEY constraint failed')
  );
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (isForeignKeyError(err)) {
    return res.status(401).json({
      error: 'Session expired. Please login again.',
    });
  }

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && status >= 500
      ? { stack: err.stack }
      : {}),
  });
}

module.exports = errorHandler;
