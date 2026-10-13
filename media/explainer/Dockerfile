FROM node:22
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
CMD ["npm", "run", "render"]
