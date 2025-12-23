from ubuntu:latest

RUN  apt update -y &&  apt install -y curl
RUN install -dm 755 /etc/apt/keyrings
RUN  curl -fSs https://mise.jdx.dev/gpg-key.pub | tee /etc/apt/keyrings/mise-archive-keyring.pub 1> /dev/null
RUN echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.pub arch=arm64] https://mise.jdx.dev/deb stable main" | tee /etc/apt/sources.list.d/mise.list
RUN apt update -y && apt install -y mise
ENV MISE_BACKENDS_SOLIDITY=asdf:diegodorado/asdf-solidity