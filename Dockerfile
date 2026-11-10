FROM node:22-bookworm-slim
# ffmpeg = mp3 conversion, python3 = yt-dlp, git = fetch the PO-token provider below.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip git zip && \
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
# --ignore-scripts: yt-dlp-exec's own preinstall wants a `python` name and its postinstall reaches GitHub
# mid-build, and both are fragile in a slim image. Its binary is fetched explicitly below instead.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
# The official standalone yt-dlp binary is the only build that can actually self-update, which is what
# `ytdlp(url, { update: true })` relies on — so it, not the pip copy, runs the downloads.
ENV YTDLP_PLUGIN_DIRS=/app/node_modules/yt-dlp-exec/bin/yt-dlp-plugins
ENV FFMPEG_PATH=/usr/bin/ffmpeg
RUN mkdir -p /app/node_modules/yt-dlp-exec/bin "$YTDLP_PLUGIN_DIRS" && \
    curl -fsSL -o /app/node_modules/yt-dlp-exec/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && \
    chmod +x /app/node_modules/yt-dlp-exec/bin/yt-dlp
# The standalone binary cannot see pip-installed plugins, so hand it the PO-token provider as a plugin zip
# beside the binary (yt-dlp also reads YTDLP_PLUGIN_DIRS through --plugin-dirs).
RUN P=$(python3 -c "import yt_dlp_plugins,os;print(os.path.dirname(yt_dlp_plugins.__file__))") && \
    cd "$(dirname "$P")" && zip -qr "$YTDLP_PLUGIN_DIRS/bgutil-ytdlp-pot-provider.zip" yt_dlp_plugins && \
    ls -l /app/node_modules/yt-dlp-exec/bin/yt-dlp "$YTDLP_PLUGIN_DIRS/" && \
    /app/node_modules/yt-dlp-exec/bin/yt-dlp --version
COPY . .
ENV NODE_ENV=production
CMD ["npm","start"]
