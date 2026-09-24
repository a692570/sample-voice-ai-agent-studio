FROM python:3.12-slim

WORKDIR /app

# Install dependencies (strands-agents[bidi] comes from PyPI via requirements.txt)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user (create it after installs so pip writes to system dirs as root).
RUN useradd -m -u 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8081

# Basic liveness check against the app's HTTP port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import socket,sys; s=socket.socket(); s.settimeout(3); sys.exit(0 if s.connect_ex(('127.0.0.1',8081))==0 else 1)"

CMD ["uvicorn", "strands_agent:app", "--host", "0.0.0.0", "--port", "8081"]
