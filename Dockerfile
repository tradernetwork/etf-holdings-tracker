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

# Copy data directory. On the old Vultr box this dir was a bind-mounted
# volume (holdings CSVs written by the scraper on the host); Railway has no
# equivalent persistent host mount, so the data the API reads at runtime
# must be baked into the image at build time instead.
COPY etf-dashboard/public/data/ etf-dashboard/public/data/

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
