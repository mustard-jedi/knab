// PM2 process file. Start with: pm2 start ecosystem.config.cjs
// Settings such as PORT and HOST are read from .env by the app itself.
module.exports = {
  apps: [
    {
      name: 'knab',
      script: 'server/index.js',
      cwd: __dirname,
      // Keep this at one process: the database is a single SQLite file and the
      // recurring-transaction job runs inside the server.
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      kill_timeout: 5000,
      time: true,
    },
  ],
};
