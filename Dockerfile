# CallEnvoy in one image: the built console and the Python service.
# Build and run with docker compose (see docs/SELF_HOSTING.md).

# --- 1. the console (an Expo web export; static files) ---
FROM node:22-slim AS console
WORKDIR /src/client
RUN corepack enable
COPY client/package.json client/pnpm-lock.yaml client/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY client/ ./
RUN pnpm exec expo export --platform web

# --- 2. the service ---
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev
COPY callenvoy/ callenvoy/
COPY --from=console /src/client/dist client/dist
# data/ holds the database and cached recordings: mount it as a volume.
VOLUME /app/data
EXPOSE 3021
# One worker only: live call state is in memory.
CMD ["uv", "run", "--frozen", "--no-dev", "uvicorn", "callenvoy.main:app", "--host", "0.0.0.0", "--port", "3021", "--no-access-log"]
