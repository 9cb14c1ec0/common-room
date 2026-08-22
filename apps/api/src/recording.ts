import AgoraToken from "agora-token";

interface RecordingSession { resourceId: string; sid: string; uid: string }
interface RecordingConfiguration { appId: string; appCertificate: string; customerId: string; customerSecret: string; bucket: string; accessKey: string; secretKey: string; vendor: number; region: number }

function configuration(): RecordingConfiguration | undefined {
  const values = {
    appId: process.env.AGORA_APP_ID,
    appCertificate: process.env.AGORA_APP_CERTIFICATE,
    customerId: process.env.AGORA_CUSTOMER_ID,
    customerSecret: process.env.AGORA_CUSTOMER_SECRET,
    bucket: process.env.OBJECT_STORAGE_BUCKET,
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY,
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    vendor: Number(process.env.AGORA_RECORDING_STORAGE_VENDOR),
    region: Number(process.env.AGORA_RECORDING_STORAGE_REGION)
  };
  return Object.values(values).some((value) => !value || (typeof value === "number" && !Number.isFinite(value))) ? undefined : values as RecordingConfiguration;
}

async function agoraRequest<T>(path: string, method: "POST" | "GET", body?: unknown): Promise<T> {
  const config = configuration();
  if (!config) throw new Error("Agora Cloud Recording is not configured");
  const response = await fetch(`https://api.agora.io/v1/apps/${config.appId}/cloud_recording${path}`, {
    method,
    headers: { authorization: `Basic ${Buffer.from(`${config.customerId}:${config.customerSecret}`).toString("base64")}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(`Agora recording request failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

export function recordingIsConfigured() { return Boolean(configuration()); }

export async function startAgoraRecording(channelName: string, meetingId: string): Promise<RecordingSession> {
  const config = configuration();
  if (!config) throw new Error("Agora Cloud Recording is not configured");
  const uid = `recorder-${meetingId}`.slice(0, 64);
  const acquired = await agoraRequest<{ resourceId: string }>("/acquire", "POST", { cname: channelName, uid, clientRequest: { resourceExpiredHour: 24 } });
  const expiresInSeconds = 6 * 60 * 60;
  const token = AgoraToken.RtcTokenBuilder.buildTokenWithUserAccount(config.appId, config.appCertificate, channelName, uid, AgoraToken.RtcRole.SUBSCRIBER, expiresInSeconds, expiresInSeconds);
  const started = await agoraRequest<{ sid: string }>(`/resourceid/${acquired.resourceId}/mode/mix/start`, "POST", {
    cname: channelName,
    uid,
    clientRequest: {
      token,
      recordingConfig: { channelType: 0, streamTypes: 2, audioProfile: 1, maxIdleTime: 60 },
      recordingFileConfig: { avFileType: ["hls", "mp4"] },
      storageConfig: { vendor: config.vendor, region: config.region, bucket: config.bucket, accessKey: config.accessKey, secretKey: config.secretKey, fileNamePrefix: ["common-room", meetingId] }
    }
  });
  return { resourceId: acquired.resourceId, sid: started.sid, uid };
}

export async function stopAgoraRecording(channelName: string, session: RecordingSession) {
  return agoraRequest<Record<string, unknown>>(`/resourceid/${session.resourceId}/sid/${session.sid}/mode/mix/stop`, "POST", { cname: channelName, uid: session.uid, clientRequest: { async_stop: false } });
}
