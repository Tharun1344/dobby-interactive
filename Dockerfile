FROM node:22-bookworm-slim
# ffmpeg = mp3 conversion, python3 = yt-dlp, git = fetch the PO-token provider below.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip git zip && \
    python3 -m pip install --break-system-packages --no-cache-dir -U "yt-dlp[default]" bgutil-ytdlp-pot-provider && \
    rm -rf /var/lib/apt/lists/*
# YouTube answers a datacenter IP with "Sign in to confirm you're not a bot" unless the request carries a
# PO token, and cookies do NOT fix that (a logged-in session gets a SABR-only format list). Bake the
# bgutil provider in and run it in script mode — the yt-dlp plugin generates a token per request, so no
# second service has to be supervised. plugins/download.js passes the script path automatically.
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/pot && \
    cd /opt/pot/server && npm install --no-audit --no-fund && npx tsc && \
    test -f /opt/pot/server/build/generate_once.js && rm -rf /opt/pot/.git
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
# yt-dlp-exec downloads the official standalone yt-dlp binary — the only build that can actually
# self-update (`ytdlp(url, { update: true })`), which is why it, and not the pip copy, runs the downloads.
# The standalone binary cannot see pip-installed plugins, so hand it the PO-token provider as a plugin zip
# beside the binary (yt-dlp also reads YTDLP_PLUGIN_DIRS through --plugin-dirs).
ENV YTDLP_PLUGIN_DIRS=/app/node_modules/yt-dlp-exec/bin/yt-dlp-plugins
RUN mkdir -p "$YTDLP_PLUGIN_DIRS" && \
    P=$(python3 -c "import yt_dlp_plugins,os;print(os.path.dirname(yt_dlp_plugins.__file__))") && \
    cd "$(dirname "$P")" && zip -qr "$YTDLP_PLUGIN_DIRS/bgutil-ytdlp-pot-provider.zip" yt_dlp_plugins && \
    ls -l /app/node_modules/yt-dlp-exec/bin/yt-dlp "$YTDLP_PLUGIN_DIRS/"
COPY . .
ENV NODE_ENV=production
CMD ["npm","start"]
