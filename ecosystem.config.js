/**
 * PM2 Ecosystem Config — AdScale Labs Express Server
 *
 * On Hostinger VPS:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup   ← run the command it prints to auto-start on reboot
 */

module.exports = {
  apps: [
    {
      name: 'adscale-server',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Merge stdout and stderr into a single log file
      merge_logs: true,
    },
  ],
};
