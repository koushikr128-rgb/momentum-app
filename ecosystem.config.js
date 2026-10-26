module.exports = {
  apps: [
    {
      name: "momentum-app",
      script: "npm",
      args: "start",
      cwd: "/home/deploy/momentum-app",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        PYTHON_BACKEND_URL: "http://127.0.0.1:5001",
      },
      env_file: ".env.local",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
    },
    {
      name: "python-backend",
      script: "gunicorn",
      args: "-w 2 -b 127.0.0.1:5001 --timeout 120 render_server:app",
      cwd: "/home/deploy/momentum-app/scripts",
      env: {
        PYTHONUNBUFFERED: "1",
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      interpreter: "python3",
    },
  ],
};
