FROM node:22-bookworm-slim
# ffmpeg = mp3 conversion, python3 = yt-dlp, git = fetch the PO-token provider below.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip git && \
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
# --ignore-scripts keeps the build deterministic (yt-dlp-exec's preinstall wants a `python` name and its
# postinstall reaches GitHub mid-build). plugins/download.js fetches the standalone yt-dlp binary itself on
# first boot — that binary is the only build that can self-update, which `ytdlp(url, {update:true})` needs.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
ENV FFMPEG_PATH=/usr/bin/ffmpeg
COPY . .
ENV NODE_ENV=production
CMD ["npm","start"]
