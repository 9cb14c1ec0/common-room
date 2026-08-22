FROM node:24-bookworm AS node-build
WORKDIR /app
COPY . .
RUN npm ci --include=dev && npm run build -w @office/worker

FROM maven:3.9-eclipse-temurin-21 AS recorder-build
ARG AGORA_RECORDER_COMMIT=26dc261d29aac98ee954857666fa7e877d79c249
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/AgoraIO-Extensions/Agora-Recording-Java-SDK.git /src/agora-recorder && cd /src/agora-recorder && git checkout "$AGORA_RECORDER_COMMIT"
WORKDIR /src/agora-recorder/Examples-Mvn
RUN sed -i 's/4\.4\.150\.100/4.4.151.1/g' pom.xml && mvn -DskipTests package
RUN mkdir -p /opt/agora/native && cd /opt/agora/native && jar xf /root/.m2/repository/io/agora/rtc/linux-recording-java-sdk/4.4.151.1/linux-recording-java-sdk-4.4.151.1.jar

FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=node-build /app /app
COPY --from=recorder-build /src/agora-recorder/Examples-Mvn/target/agora-example.jar /opt/agora/agora-example.jar
COPY --from=recorder-build /opt/agora/native/native/linux/x86_64 /opt/agora/native
ENV LD_LIBRARY_PATH=/opt/agora/native:/usr/lib/x86_64-linux-gnu
CMD ["node", "apps/worker/dist/index.js"]
