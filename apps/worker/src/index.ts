import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AgoraToken from "agora-token";
import pg from "pg";

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const recordingRoot = process.env.RECORDING_TEMP_DIR ?? "/tmp/common-room-recordings";
const recorderJar = process.env.AGORA_RECORDER_JAR ?? "/opt/agora/agora-example.jar";
const emptyRoomGraceMs = Number(process.env.EMPTY_ROOM_GRACE_MS ?? 10_000);
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined, max: 3 }) : undefined;
const recorders = new Map<string, { child: ChildProcessWithoutNullStreams; recordingPath: string; stopping: boolean; remoteUsers: Set<string>; sawParticipant: boolean; emptySince?: number; logBuffer: string }>();
let processingTranscript = false;
let processingSummary = false;

interface MeetingAnalysis {
  summary: string;
  decisions: string[];
  actionItems: Array<{ description: string; assigneeName: string | null; dueDate: string | null; sourceTimestampSeconds: number | null; confidence: number }>;
}

function transcriptText(transcript: unknown): string {
  if (!transcript || typeof transcript !== "object") return typeof transcript === "string" ? transcript.trim() : "";
  const value = transcript as { text?: unknown; words?: unknown };
  if (typeof value.text === "string" && value.text.trim()) return value.text.trim();
  if (Array.isArray(value.words)) return value.words.map((word) => {
    if (typeof word === "string") return word;
    if (word && typeof word === "object" && "text" in word && typeof word.text === "string") return word.text;
    return "";
  }).join(" ").replace(/\s+/g, " ").trim();
  return "";
}

function recorderToken(channelName: string, uid: string) {
  const appId = process.env.AGORA_APP_ID;
  const certificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !certificate) throw new Error("Agora recorder credentials are not configured");
  const expires = 12 * 60 * 60;
  return { appId, token: AgoraToken.RtcTokenBuilder.buildTokenWithUserAccount(appId, certificate, channelName, uid, AgoraToken.RtcRole.SUBSCRIBER, expires, expires) };
}

async function startNextRecording() {
  if (!pool) return;
  try { await stat(recorderJar); } catch { return; }
  const claimed = await pool.query("UPDATE meetings SET recording_status='starting',processing_error=NULL WHERE id=(SELECT id FROM meetings WHERE recording_status='queued' AND status='active' ORDER BY started_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,agora_channel_name");
  const meeting = claimed.rows[0] as { id: string; agora_channel_name: string } | undefined;
  if (!meeting) return;
  try {
    await mkdir(recordingRoot, { recursive: true });
    const recordingPath = path.join(recordingRoot, `${meeting.id}.mp4`);
    const configPath = path.join(recordingRoot, `${meeting.id}.json`);
    const uid = `recorder-${meeting.id}`;
    const credentials = recorderToken(meeting.agora_channel_name, uid);
    await writeFile(configPath, JSON.stringify({
      appId: credentials.appId, token: credentials.token, channelName: meeting.agora_channel_name,
      useStringUid: true, useCloudProxy: false, userId: uid,
      subAllAudio: true, subAudioUserList: [], subAllVideo: false, subVideoUserList: [], subStreamType: "low",
      enableRecording: true, enableCapture: false, isMix: true, layoutMode: "bestfit", maxResolutionUid: "",
      recorderStreamType: "audio_only", recorderPath: recordingPath, maxDuration: 43200, recoverFile: true,
      audio: { sampleRate: 16000, numOfChannels: 1 }, video: { width: 640, height: 360, fps: 15 },
      waterMark: [], encryption: { mode: "", key: "", salt: "" }, rotation: [],
      stressTest: { enable: false, enableSingleChannel: true, threadNum: 1, testTime: 1, oneTestTime: 1, sleepTime: 1 }
    }));
    const child = spawn("java", ["-Dloader.main=io.agora.example.recording.cli.CliLauncher", "-cp", recorderJar, "org.springframework.boot.loader.PropertiesLauncher", `--configFileName=${configPath}`], { cwd: "/opt/agora", stdio: ["pipe", "pipe", "pipe"] });
    recorders.set(meeting.id, { child, recordingPath, stopping: false, remoteUsers: new Set(), sawParticipant: false, logBuffer: "" });
    child.stdout.on("data", (data) => {
      process.stdout.write(`[recorder ${meeting.id}] ${data}`);
      const recorder = recorders.get(meeting.id);
      if (!recorder) return;
      recorder.logBuffer += String(data);
      const lines = recorder.logBuffer.split(/\r?\n/);
      recorder.logBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const joined = line.match(/onUserJoined .* userId:([^\s]+)/)?.[1];
        const left = line.match(/onUserLeft .* userId:([^\s]+)/)?.[1];
        if (joined && !joined.startsWith("recorder-")) { recorder.remoteUsers.add(joined); recorder.sawParticipant = true; recorder.emptySince = undefined; }
        if (left && !left.startsWith("recorder-")) {
          recorder.remoteUsers.delete(left);
          if (recorder.sawParticipant && recorder.remoteUsers.size === 0) recorder.emptySince = Date.now();
        }
      }
    });
    child.stderr.on("data", (data) => process.stderr.write(`[recorder ${meeting.id}] ${data}`));
    child.once("error", (error) => void failRecording(meeting.id, error));
    child.once("close", (code) => void finishRecording(meeting.id, recordingPath, code));
    await pool.query("UPDATE meetings SET recording_status='recording',recording_url=$1 WHERE id=$2", [recordingPath, meeting.id]);
  } catch (error) { await failRecording(meeting.id, error); }
}

async function failRecording(meetingId: string, error: unknown) {
  recorders.delete(meetingId);
  await pool?.query("UPDATE meetings SET recording_status='failed',processing_error=$1 WHERE id=$2", [error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), meetingId]);
  console.error(JSON.stringify({ level: "error", service: "office-worker", message: "Local recording failed", meetingId, error: error instanceof Error ? error.message : String(error) }));
}

async function finishRecording(meetingId: string, recordingPath: string, code: number | null) {
  recorders.delete(meetingId);
  try {
    let actualRecordingPath = recordingPath;
    try {
      await stat(actualRecordingPath);
    } catch {
      const candidates = (await readdir(recordingRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${meetingId}_`) && entry.name.endsWith(".mp4"))
        .map((entry) => path.join(recordingRoot, entry.name));
      if (!candidates.length) throw new Error(`Agora did not create an MP4 for meeting ${meetingId}`);
      const files = await Promise.all(candidates.map(async (candidate) => ({ candidate, modified: (await stat(candidate)).mtimeMs })));
      actualRecordingPath = files.sort((left, right) => right.modified - left.modified)[0].candidate;
    }
    const file = await stat(actualRecordingPath);
    if (code !== 0 || file.size === 0) throw new Error(`Recorder exited with code ${code} and ${file.size} bytes`);
    await pool?.query("UPDATE meetings SET recording_status='recorded',recording_url=$1,next_processing_at=now(),processing_error=NULL WHERE id=$2", [actualRecordingPath, meetingId]);
    console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Recording ready for transcription", meetingId, recordingPath: actualRecordingPath, bytes: file.size }));
  } catch (error) { await failRecording(meetingId, error); }
}

async function stopFinishedMeetings() {
  if (!pool || recorders.size === 0) return;
  const result = await pool.query("SELECT id FROM meetings WHERE id=ANY($1::uuid[]) AND status='processing'", [[...recorders.keys()]]);
  for (const row of result.rows) {
    const recorder = recorders.get(row.id);
    if (recorder && !recorder.stopping) { recorder.stopping = true; recorder.child.stdin.write("1\n"); }
  }
}

async function stopEmptyRooms() {
  if (!pool) return;
  for (const [meetingId, recorder] of recorders) {
    if (recorder.stopping || !recorder.sawParticipant || recorder.remoteUsers.size || !recorder.emptySince || Date.now() - recorder.emptySince < emptyRoomGraceMs) continue;
    recorder.stopping = true;
    await pool.query("UPDATE meetings SET status='processing',ended_at=coalesce(ended_at,now()) WHERE id=$1 AND status='active'", [meetingId]);
    await pool.query("DELETE FROM meeting_requests WHERE meeting_id=$1", [meetingId]);
    recorder.child.stdin.write("1\n");
    console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Finalizing recording after the room became empty", meetingId }));
  }
}

// Mirrors the normalizer in apps/api/src/keyTerms.ts. The worker cannot import it: @office/contracts
// ships raw TypeScript, and the worker compiles with tsc and runs the emitted JavaScript.
const KEY_TERM_MAX_COUNT = 1000;
const KEY_TERM_MAX_LENGTH = 50;
const KEY_TERM_MAX_WORDS = 5;

function usableKeyTerms(candidates: string[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const term = candidate.trim();
    if (!term || term.length > KEY_TERM_MAX_LENGTH || term.split(/\s+/).length > KEY_TERM_MAX_WORDS || /[<>{}[\]\\]/.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === KEY_TERM_MAX_COUNT) break;
  }
  return terms;
}

// Admin-curated vocabulary plus the display names of everyone in the meeting, so ElevenLabs spells
// product names, jargon, and teammates correctly.
async function keyTermsForMeeting(meetingId: string): Promise<string[]> {
  if (!pool) return [];
  const [configured, participants] = await Promise.all([
    pool.query("SELECT term FROM transcription_key_terms ORDER BY lower(term)"),
    pool.query("SELECT DISTINCT u.display_name FROM meeting_participants p JOIN users u ON u.id=p.user_id WHERE p.meeting_id=$1", [meetingId])
  ]);
  return usableKeyTerms([...configured.rows.map((row) => row.term as string), ...participants.rows.map((row) => row.display_name as string)]);
}

async function transcribeFile(recordingPath: string, keyterms: string[]) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
  const bytes = await readFile(recordingPath);
  const recordingBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(recordingBuffer).set(bytes);
  const form = new FormData();
  form.append("file", new Blob([recordingBuffer], { type: "video/mp4" }), path.basename(recordingPath));
  form.append("model_id", "scribe_v2");
  form.append("diarize", "true");
  form.append("tag_audio_events", "false");
  // Repeated fields, one per term: that is how ElevenLabs encodes the list. Appending none keeps the
  // request on base pricing, since key term prompting adds a 20% surcharge.
  for (const term of keyterms) form.append("keyterms", term);
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  const transcript = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ElevenLabs transcription failed (${response.status}): ${JSON.stringify(transcript)}`);
  return transcript;
}

async function processNextTranscript() {
  if (!pool || processingTranscript) return;
  processingTranscript = true;
  let meeting: { id: string; recording_url: string; transcription_attempts: number } | undefined;
  try {
    const claimed = await pool.query("UPDATE meetings SET recording_status='transcribing',processing_error=NULL WHERE id=(SELECT id FROM meetings WHERE recording_status='recorded' AND transcript IS NULL AND coalesce(next_processing_at,now())<=now() ORDER BY ended_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,recording_url,transcription_attempts");
    meeting = claimed.rows[0];
    if (!meeting) return;
    const keyterms = await keyTermsForMeeting(meeting.id);
    const transcript = await transcribeFile(meeting.recording_url, keyterms);
    const text = transcriptText(transcript);
    if (!text) throw new Error("ElevenLabs returned a successful response but no transcript text; the recording was retained for retry");
    await pool.query("UPDATE meetings SET transcript=$1,recording_status='transcribed',processing_error=NULL WHERE id=$2", [JSON.stringify(transcript), meeting.id]);
    await rm(meeting.recording_url, { force: true });
    await rm(path.join(recordingRoot, `${meeting.id}.json`), { force: true });
    console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Meeting transcribed and recording deleted", meetingId: meeting.id, transcriptCharacters: text.length, transcriptWords: text.split(/\s+/).length, keyTermCount: keyterms.length }));
  } catch (error) {
    if (meeting) {
      const attempts = meeting.transcription_attempts + 1;
      await pool.query("UPDATE meetings SET recording_status=$1,transcription_attempts=$2,next_processing_at=now()+($3::text || ' minutes')::interval,processing_error=$4 WHERE id=$5", [attempts >= 5 ? "failed" : "recorded", attempts, Math.min(60, 2 ** attempts), error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), meeting.id]);
      if (attempts >= 5) await rm(meeting.recording_url, { force: true });
    }
    console.error(JSON.stringify({ level: "error", service: "office-worker", message: "Meeting transcription failed", meetingId: meeting?.id, error: error instanceof Error ? error.message : String(error) }));
  } finally { processingTranscript = false; }
}

async function analyzeTranscript(transcript: unknown, participants: Array<{ id: string; name: string }>): Promise<MeetingAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const text = transcriptText(transcript);
  if (!text) throw new Error("Meeting transcript contains no speech text to analyze");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "Common Room" },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-5.6-luna",
      messages: [
        { role: "system", content: "Analyze an internal company meeting transcript. Be concise and factual. Propose an action item only when the transcript contains a genuine commitment, request, or clearly assigned next step. Never invent an assignee or due date. Use only participant names from the supplied list; otherwise use null. Timestamps must point to supporting transcript evidence." },
        { role: "user", content: JSON.stringify({ participants: participants.map((item) => item.name), transcript: text }) }
      ],
      provider: { require_parameters: true },
      response_format: { type: "json_schema", json_schema: { name: "meeting_analysis", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["summary", "decisions", "actionItems"],
        properties: {
          summary: { type: "string" },
          decisions: { type: "array", items: { type: "string" } },
          actionItems: { type: "array", items: { type: "object", additionalProperties: false, required: ["description", "assigneeName", "dueDate", "sourceTimestampSeconds", "confidence"], properties: {
            description: { type: "string" }, assigneeName: { type: ["string", "null"] }, dueDate: { type: ["string", "null"], description: "ISO 8601 date if explicitly stated" }, sourceTimestampSeconds: { type: ["number", "null"] }, confidence: { type: "number", minimum: 0, maximum: 1 }
          } } }
        }
      } } }
    })
  });
  const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: unknown };
  const content = payload.choices?.[0]?.message?.content;
  if (!response.ok || !content) throw new Error(`OpenRouter analysis failed (${response.status}): ${JSON.stringify(payload.error ?? payload)}`);
  const analysis = JSON.parse(content) as MeetingAnalysis;
  if (!analysis.summary || !Array.isArray(analysis.decisions) || !Array.isArray(analysis.actionItems)) throw new Error("OpenRouter returned an invalid meeting analysis");
  return analysis;
}

async function processNextSummary() {
  if (!pool || processingSummary) return;
  processingSummary = true;
  let meeting: { id: string; transcript: unknown; transcription_attempts: number; participants: Array<{ id: string; name: string }> } | undefined;
  try {
    const claimed = await pool.query(`UPDATE meetings SET recording_status='summarizing',processing_error=NULL WHERE id=(SELECT id FROM meetings WHERE recording_status='transcribed' AND summary IS NULL AND coalesce(next_processing_at,now())<=now() ORDER BY ended_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,transcript,transcription_attempts`);
    const row = claimed.rows[0] as Omit<NonNullable<typeof meeting>, "participants"> | undefined;
    if (!row) return;
    const participantRows = await pool.query("SELECT u.id,u.display_name name FROM meeting_participants p JOIN users u ON u.id=p.user_id WHERE p.meeting_id=$1 ORDER BY u.display_name", [row.id]);
    meeting = { ...row, participants: participantRows.rows };
    const analysis = await analyzeTranscript(meeting.transcript, meeting.participants);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM action_items WHERE meeting_id=$1 AND status='proposed'", [meeting.id]);
      for (const item of analysis.actionItems.filter((candidate) => candidate.description.trim())) {
        const assignee = item.assigneeName ? meeting.participants.find((participant) => participant.name.localeCompare(item.assigneeName!, undefined, { sensitivity: "base" }) === 0) : undefined;
        const dueAt = item.dueDate && !Number.isNaN(Date.parse(item.dueDate)) ? new Date(item.dueDate) : null;
        await client.query("INSERT INTO action_items(meeting_id,assignee_id,description,source_timestamp_seconds,confidence,due_at) VALUES($1,$2,$3,$4,$5,$6)", [meeting.id, assignee?.id ?? null, item.description.trim(), item.sourceTimestampSeconds === null ? null : Math.max(0, Math.round(item.sourceTimestampSeconds)), Math.max(0, Math.min(1, item.confidence)), dueAt]);
      }
      const summary = analysis.decisions.length ? `${analysis.summary}\n\nDecisions:\n${analysis.decisions.map((decision) => `• ${decision}`).join("\n")}` : analysis.summary;
      await client.query("UPDATE meetings SET summary=$1,status='complete',recording_status='analyzed',processing_error=NULL WHERE id=$2", [summary, meeting.id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Meeting summarized", meetingId: meeting.id, actionItemCount: analysis.actionItems.length }));
  } catch (error) {
    if (meeting) {
      const attempts = meeting.transcription_attempts + 1;
      await pool.query("UPDATE meetings SET recording_status=$1,transcription_attempts=$2,next_processing_at=now()+($3::text || ' minutes')::interval,processing_error=$4,status=CASE WHEN $1::text='failed' THEN 'failed' ELSE status END WHERE id=$5", [attempts >= 5 ? "failed" : "transcribed", attempts, Math.min(60, 2 ** attempts), error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), meeting.id]);
    }
    console.error(JSON.stringify({ level: "error", service: "office-worker", message: "Meeting analysis failed", meetingId: meeting?.id, error: error instanceof Error ? error.message : String(error) }));
  } finally { processingSummary = false; }
}

async function tick() {
  try { await stopEmptyRooms(); await stopFinishedMeetings(); await startNextRecording(); await processNextTranscript(); await processNextSummary(); }
  catch (error) { console.error(JSON.stringify({ level: "error", service: "office-worker", message: "Worker tick failed", error: error instanceof Error ? error.message : String(error) })); }
}

console.log(JSON.stringify({ level: "info", service: "office-worker", message: "Self-hosted recorder worker started", intervalMs, database: Boolean(pool) }));
void pool?.query("UPDATE meetings SET recording_status='failed',processing_error='Recorder worker restarted before the temporary recording completed' WHERE recording_status IN ('starting','recording','transcribing')");
void pool?.query("UPDATE meetings SET recording_status='transcribed',processing_error='Analysis requeued after worker restart',next_processing_at=now() WHERE recording_status='summarizing'");
const timer = setInterval(() => void tick(), intervalMs);
void tick();

async function shutdown() {
  clearInterval(timer);
  for (const recorder of recorders.values()) recorder.child.stdin.write("1\n");
  await pool?.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
