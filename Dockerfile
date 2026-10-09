FROM python:3.12-slim

WORKDIR /app

# Install deps
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# Copy API code
COPY api/ api/

# Copy effectiveness engine (used by api.server for /api/v1/fund-effectiveness)
COPY effectiveness.py effectiveness.py

# Copy CBOE scanner (used by api.server for /api/v1/options-listings)
COPY cboe_scanner.py cboe_scanner.py

# llms.txt: single source of truth shared with the dashboard, served at /llms.txt
COPY etf-dashboard/public/llms.txt etf-dashboard/public/llms.txt

# Copy data directory (mounted as volume in production)
# In production, mount the real data dir to /app/etf-dashboard/public/data
RUN mkdir -p etf-dashboard/public/data/history

# Expose port
# Commit this image was built from, surfaced on /health so deployment drift
# is observable. sync_data.sh passes it; defaults to 'unknown' for local builds.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

EXPOSE 8100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8100/health')" || exit 1

# Run with uvicorn
CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "2"]
