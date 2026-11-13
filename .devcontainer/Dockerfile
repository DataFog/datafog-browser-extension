FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    sudo \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

COPY .nvmrc /opt/datafog-pins/.nvmrc
COPY scripts/pin.sh /opt/datafog-pins/scripts/pin.sh
RUN chmod +x /opt/datafog-pins/scripts/pin.sh

RUN NODE_VERSION=$(/opt/datafog-pins/scripts/pin.sh node) && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN usermod -aG sudo ubuntu \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER ubuntu
WORKDIR /workspace
