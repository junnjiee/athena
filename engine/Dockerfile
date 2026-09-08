FROM python:3.12-slim

# uv resolves and installs far faster than pip, and the lockfile is what makes
# a container reproduce the dev environment exactly.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Dependencies first, so editing engine source doesn't re-resolve them.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY athena ./athena
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "athena.service:app", "--host", "0.0.0.0", "--port", "8000"]
