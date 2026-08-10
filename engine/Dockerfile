FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    ATHENA_PROCESS=api

WORKDIR /app

RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY athena ./athena

CMD ["sh", "-c", "if [ \"${ATHENA_PROCESS}\" = worker ]; then exec .venv/bin/arq athena.hosted.worker.WorkerSettings; else exec .venv/bin/uvicorn athena.hosted.api:app --host 0.0.0.0 --port ${PORT}; fi"]
