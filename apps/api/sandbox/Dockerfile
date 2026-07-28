FROM alpine:3.23

ARG AGENT_BROWSER_VERSION=0.26.0
ARG TARGETARCH

RUN apk add --no-cache ca-certificates chromium font-noto \
  && case "$TARGETARCH" in \
    amd64) agent_browser_arch=x64 ;; \
    arm64) agent_browser_arch=arm64 ;; \
    *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && wget -q \
    "https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/agent-browser-linux-musl-${agent_browser_arch}" \
    -O /usr/local/bin/agent-browser \
  && chmod 0755 /usr/local/bin/agent-browser \
  && ln -s "$(command -v chromium-browser || command -v chromium)" /usr/local/bin/browser \
  && wget -q \
    "https://registry.npmjs.org/agent-browser/-/agent-browser-${AGENT_BROWSER_VERSION}.tgz" \
    -O /tmp/agent-browser.tgz \
  && tar -xzf /tmp/agent-browser.tgz -C /tmp \
  && mkdir -p /usr/local/share/agent-browser \
  && mv /tmp/package/skill-data /usr/local/share/agent-browser/skills \
  && rm -rf /tmp/agent-browser.tgz /tmp/package

COPY --chmod=0755 start-agent-browser-chromium /usr/local/bin/

ENV AGENT_BROWSER_ARGS=--no-sandbox
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/local/bin/browser
ENV AGENT_BROWSER_SKILLS_DIR=/usr/local/share/agent-browser/skills
