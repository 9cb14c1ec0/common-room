import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined, max: 3 }) : undefined;
let processing = false;

function findRecordingKey(value: unknown): string | undefined {
  const candidates: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === "string" && /\.(mp4|m4a|wav|webm|m3u8)$/i.test(item)) candidates.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return candidates.find((item) => /\.mp4$/i.test(item)) ?? candidates.find((item) => !/\.m3u8$/i.test(item)) ?? candidates[0];
}

function storageClient() {
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error("Object storage credentials are not configured");
  return new S3Client({ region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1", ...(process.env.OBJECT_STORAGE_ENDPOINT ? { endpoint: process.env.OBJECT_STORAGE_ENDPOINT, forcePathStyle: true } : {}), credentials: { accessKeyId, secretAccessKey } });
}

async function transcribe(meeting: { id: string; recording_files: unknown }) {
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!bucket || !apiKey) throw new Error("Transcription credentials are not configured");
  const key = findRecordingKey(meeting.recording_files);
  if (!key || /\.m3u8$/i.test(key)) throw new Error("Agora has not produced a self-contained recording file yet");
  const object = await storageClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!object.Body) throw new Error("The recording object was empty");
  const bytes = await object.Body.transformToByteArray();
  const recordingBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(recordingBuffer).set(bytes);
  const form = new FormData();
  form.append("file", new Blob([recordingBuffer], { type: object.ContentType ?? "video/mp4" }), key.split("/").at(-1) ?? "meeting.mp4");
  form.append("model_id", "scribe_v2");
  form.append("diarize", "true");
  form.append("tag_audio_events", "false");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  const transcript = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ElevenLabs transcription failed (${response.status}): ${JSON.stringify(transcript)}`);
  return { transcript, key };
}

async function processNext() {
  if (!pool || processing) return;
  processing = true;
  let meeting: { id: string; recording_files: unknown; transcription_attempts: number } | undefined;
  try {
    const claimed = await pool.query("UPDATE meetings SET recording_status='transcribing',processing_error=NULL WHERE id=(SELECT id FROM meetings WHERE recording_status='recorded' AND transcript IS NULL AND coalesce(next_processing_at,now())<=now() ORDER BY ended_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,recording_files,transcription_attempts");
    meeting = claimed.rows[0];
    if (!meeting) return;
    const result = await transcribe(meeting);
    await pool.query("UPDATE meetings SET transcript=$1,recording_url=$2,recording_status='transcribed',processing_error=NULL WHERE id=$3", [JSON.stringify(result.transcript), result.key, meeting.id]);
    console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Meeting transcribed", meetingId: meeting.id }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", service: "office-worker", message: "Meeting transcription failed", meetingId: meeting?.id, error: error instanceof Error ? error.message : String(error) }));
    if (meeting) {
      const attempts = meeting.transcription_attempts + 1;
      await pool?.query("UPDATE meetings SET recording_status=$1,transcription_attempts=$2,next_processing_at=now()+($3::text || ' minutes')::interval,processing_error=$4 WHERE id=$5", [attempts >= 5 ? "failed" : "recorded", attempts, Math.min(60, 2 ** attempts), error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), meeting.id]);
    }
  } finally { processing = false; }
}

console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Worker started", intervalMs, database: Boolean(pool) }));
const timer = setInterval(() => void processNext(), intervalMs);
void processNext();

async function shutdown() {
  clearInterval(timer);
  await pool?.end();
  console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Worker stopped" }));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
