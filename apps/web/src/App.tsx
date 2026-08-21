import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bell, Check, Clock3, DoorClosed, DoorOpen, History, Mic, MicOff, PhoneOff, Search, Users, Video, VideoOff, X } from "lucide-react";
import type { MeetingSummary, Person } from "@office/contracts";

const configuredApiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const apiUrl = configuredApiUrl && configuredApiUrl !== window.location.origin
  ? configuredApiUrl
  : window.location.hostname === "common-room-web.onrender.com" ? "https://common-room-api.onrender.com" : "";

interface SessionUser { id: string; email: string; displayName: string; title: string; isAdmin: boolean }
interface AuthStatus { mode: "demo" | "database"; requiresSetup?: boolean; user: SessionUser | null }
interface RequestView { id: string; senderId: string; recipientId: string; senderName: string; recipientName: string; message?: string; status: string; direction: "incoming" | "outgoing" }
interface RoomSessionControls { join(options: { audio: boolean; video: boolean }): Promise<unknown>; leave(): Promise<void>; audioMute(): Promise<unknown>; audioUnmute(): Promise<unknown>; videoMute(): Promise<unknown>; videoUnmute(): Promise<unknown> }

export function App() {
  const [people, setPeople] = useState<Person[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [sentTo, setSentTo] = useState<string>();
  const [doorOpen, setDoorOpen] = useState(true);
  const [view, setView] = useState<"office" | "requests" | "notes" | "room">("office");
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [toast, setToast] = useState<string>();
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const signalWireRootRef = useRef<HTMLDivElement>(null);
  const roomSessionRef = useRef<RoomSessionControls | null>(null);
  const [roomMode, setRoomMode] = useState<"loading" | "signalwire" | "local">("loading");
  const [auth, setAuth] = useState<AuthStatus>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState<string>();
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPerson, setNewPerson] = useState({ displayName: "", email: "", title: "", temporaryPassword: "" });
  const [meetingId, setMeetingId] = useState("main");

  useEffect(() => {
    void refreshSession();
  }, []);

  async function refreshSession() {
    try {
      const response = await fetch(`${apiUrl}/api/auth/status`, { credentials: "include" });
      if (!response.ok) throw new Error("API unavailable");
      const status: AuthStatus = await response.json();
      setAuth(status);
      if (status.user) await loadOfficeData();
    } catch { setAuthError("The Common Room API is unavailable. Check the web service API URL."); }
  }

  async function loadOfficeData() {
    const options = { credentials: "include" as const };
    const [peopleResponse, meetingsResponse, requestsResponse] = await Promise.all([fetch(`${apiUrl}/api/people`, options), fetch(`${apiUrl}/api/meetings`, options), fetch(`${apiUrl}/api/requests`, options)]);
    if (peopleResponse.ok) setPeople((await peopleResponse.json()).people);
    if (meetingsResponse.ok) setMeetings((await meetingsResponse.json()).meetings);
    if (requestsResponse.ok) setRequests((await requestsResponse.json()).requests);
  }

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setAuthError(undefined);
    const setup = auth?.requiresSetup;
    const response = await fetch(`${apiUrl}/api/auth/${setup ? "setup" : "login"}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, displayName }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); setAuthError(body.error ?? "Unable to sign in"); return; }
    await refreshSession();
  }

  async function invite(person: Person) {
    setSentTo(person.id);
    const response = await fetch(`${apiUrl}/api/requests`, {
      method: "POST", headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ fromId: auth?.user?.id ?? "", toId: person.id, message: "Meet me in the Common Room?" })
    }).catch(() => undefined);
    if (!response || !response.ok) { showToast("The meeting request could not be sent"); setSentTo(undefined); return; }
    showToast(`Meeting request sent to ${person.name}`);
    await loadOfficeData();
    window.setTimeout(() => setSentTo(undefined), 1800);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2600);
  }

  async function enterRoom(roomId = "main") {
    setMeetingId(roomId);
    setView("room");
    setRoomMode("loading");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${roomId}/token`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: auth?.user?.displayName }) });
      if (!response.ok) throw new Error("SignalWire token unavailable");
      const { token } = await response.json();
      if (!signalWireRootRef.current) throw new Error("Room view unavailable");
      const { Video: SignalWireVideo } = await import("@signalwire/js");
      const session = new SignalWireVideo.RoomSession({ token, rootElement: signalWireRootRef.current });
      roomSessionRef.current = session;
      await session.join({ audio: true, video: true });
      setRoomMode("signalwire");
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (videoRef.current) videoRef.current.srcObject = stream;
        setRoomMode("local");
        showToast("SignalWire was unavailable; showing a local device preview.");
      } catch {
        setCameraOn(false);
        setMicOn(false);
        setRoomMode("local");
        showToast("Camera access is unavailable; room opened without media.");
      }
    }
  }

  function leaveRoom() {
    void roomSessionRef.current?.leave();
    roomSessionRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    setView("office");
  }

  async function toggleMicrophone() {
    const next = !micOn;
    if (roomMode === "signalwire" && roomSessionRef.current) {
      if (next) await roomSessionRef.current.audioUnmute(); else await roomSessionRef.current.audioMute();
    } else {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getAudioTracks().forEach((track) => track.enabled = next);
    }
    setMicOn(next);
  }

  async function toggleCamera() {
    const next = !cameraOn;
    if (roomMode === "signalwire" && roomSessionRef.current) {
      if (next) await roomSessionRef.current.videoUnmute(); else await roomSessionRef.current.videoMute();
    } else {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getVideoTracks().forEach((track) => track.enabled = next);
    }
    setCameraOn(next);
  }

  async function addPerson(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`${apiUrl}/api/users`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(newPerson) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error ?? "Unable to add teammate"); return; }
    setAddingPerson(false); setNewPerson({ displayName: "", email: "", title: "", temporaryPassword: "" });
    showToast("Teammate account created"); await loadOfficeData();
  }

  async function respondToRequest(item: RequestView, status: "accepted" | "declined" | "cancelled") {
    const response = await fetch(`${apiUrl}/api/requests/${item.id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { showToast("Unable to update the request"); return; }
    const body = await response.json();
    await loadOfficeData();
    if (status === "accepted" && body.meetingId) await enterRoom(body.meetingId);
    else showToast(status === "cancelled" ? "Request cancelled" : `Request ${status}`);
  }

  if (!auth?.user) return <div className="auth-screen"><form className="auth-card" onSubmit={(event) => void submitAuth(event)}><span className="brand-mark"><DoorOpen size={22} /></span><p className="eyebrow">COMMON ROOM</p><h1>{auth?.requiresSetup ? "Create the first account" : "Welcome back"}</h1><p>{auth?.requiresSetup ? "This account will be the administrator for your private workspace." : "Sign in to enter your company office."}</p>{auth?.requiresSetup && <label>Name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} autoComplete="name" /></label>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={auth?.requiresSetup ? 10 : undefined} autoComplete={auth?.requiresSetup ? "new-password" : "current-password"} /></label>{authError && <div className="auth-error">{authError}</div>}<button type="submit">{auth?.requiresSetup ? "Create workspace" : "Sign in"}</button></form></div>;

  if (view === "room") return <div className="room-screen">
    <div className="room-top"><button onClick={leaveRoom}><ArrowLeft size={18} /> Leave room</button><div><strong>The Common Room</strong><small>{roomMode === "signalwire" ? "Connected through SignalWire" : roomMode === "loading" ? "Connecting…" : "Local device preview"}</small></div><span className="recording-pill">{roomMode === "signalwire" ? "Live" : "Preview"}</span></div>
    <div className="video-stage"><div ref={signalWireRootRef} className={roomMode === "signalwire" ? "signalwire-root" : "signalwire-root hidden"} />{roomMode !== "signalwire" && (cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-off"><div className="avatar tone-0">MC</div><span>Camera is off</span></div>)}</div>
    <div className="call-controls">
      <button className={!micOn ? "control-off" : ""} onClick={() => void toggleMicrophone()}>{micOn ? <Mic /> : <MicOff />}</button>
      <button className={!cameraOn ? "control-off" : ""} onClick={() => void toggleCamera()}>{cameraOn ? <Video /> : <VideoOff />}</button>
      <button className="hangup" onClick={leaveRoom}><PhoneOff /></button>
    </div>
  </div>;

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-mark"><DoorOpen size={19} /></span><span>Common Room</span></div>
      <nav>
        <button className={view === "office" ? "active" : ""} onClick={() => setView("office")}><Users size={18} /> Office</button>
        <button className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}><Bell size={18} /> Requests {requests.filter((item) => item.status === "pending").length > 0 && <span className="badge">{requests.filter((item) => item.status === "pending").length}</span>}</button>
        <button className={view === "notes" ? "active" : ""} onClick={() => setView("notes")}><History size={18} /> Meeting notes</button>
      </nav>
      <div className="profile"><div className="avatar cream">{auth.user.displayName.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase()}</div><div><strong>{auth.user.displayName}</strong><small><i className="dot available" /> Available</small></div></div>
    </aside>

    <main>
      <header><div><p className="eyebrow">FRIDAY, AUGUST 21</p><h1>{view === "office" ? "Your office" : view === "requests" ? "Meeting requests" : "Meeting notes"}</h1></div><button className="icon-button" onClick={() => showToast("Search is coming in the next slice.")}><Search size={20} /></button></header>

      {view === "office" && <><section className={`hero ${doorOpen ? "" : "door-closed"}`}>
        <div><span className="room-label"><i className={`dot ${doorOpen ? "available" : "offline"}`} /> YOUR DOOR IS {doorOpen ? "OPEN" : "CLOSED"}</span><h2>{doorOpen ? "Ready when you are." : "Taking some focus time."}</h2><p>{doorOpen ? "People can ask to meet. You’ll always choose whether to join." : "New meeting requests are paused until you open your door."}</p></div>
        <button className="close-door" onClick={() => { setDoorOpen(!doorOpen); showToast(doorOpen ? "Your door is now closed" : "Your door is now open"); }}>{doorOpen ? <DoorOpen size={18} /> : <DoorClosed size={18} />} {doorOpen ? "Close my door" : "Open my door"}</button>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">THE TEAM</p><h3>Who’s around</h3></div><div className="heading-actions"><span>{people.filter((p) => p.presence === "available").length} available</span>{auth.user.isAdmin && <button onClick={() => setAddingPerson(!addingPerson)}>+ Add teammate</button>}</div></div>
        {addingPerson && <form className="add-person" onSubmit={(event) => void addPerson(event)}><input placeholder="Full name" value={newPerson.displayName} onChange={(event) => setNewPerson({...newPerson,displayName:event.target.value})} required /><input type="email" placeholder="Email" value={newPerson.email} onChange={(event) => setNewPerson({...newPerson,email:event.target.value})} required /><input placeholder="Title" value={newPerson.title} onChange={(event) => setNewPerson({...newPerson,title:event.target.value})} /><input type="password" minLength={10} placeholder="Temporary password (10+ characters)" value={newPerson.temporaryPassword} onChange={(event) => setNewPerson({...newPerson,temporaryPassword:event.target.value})} required /><button type="submit">Create account</button></form>}
        <div className="people-grid">{people.length === 0 ? <div className="empty-state"><Users size={28} /><h3>No team members yet</h3><p>Invite management is the next account feature.</p></div> : people.map((person, index) => <article className="person-card" key={person.id}>
          <div className={`avatar tone-${index}`}>{person.initials}<i className={`presence-ring ${person.presence}`} /></div>
          <div className="person-info"><strong>{person.name}</strong><small>{person.title}</small></div>
          <button disabled={person.presence !== "available" || person.id === auth.user?.id} onClick={() => invite(person)}>
            {sentTo === person.id ? "Request sent" : person.presence === "available" ? "Ask to meet" : person.presence === "busy" ? "In a meeting" : "Away"}
          </button>
        </article>)}</div>
      </section>

      <section className="lower-grid">
        <article className="common-card"><div className="common-visual"><div className="table"><span /><span /><span /></div></div><div className="common-copy"><p className="eyebrow">SHARED SPACE</p><h3>The Common Room</h3><p>Meetings here are transcribed, summarized, and turned into clear next steps.</p><div className="features"><span><Video size={15} /> SignalWire video</span><span><Mic size={15} /> Automatic notes</span></div><button className="enter-room" onClick={() => void enterRoom("main")}>Enter meeting room</button></div></article>
        <article className="notes-card"><div className="section-heading"><div><p className="eyebrow">RECENT</p><h3>Meeting notes</h3></div><button><ArrowUpRight size={18} /></button></div>
          {meetings.length ? meetings.map((meeting) => <div className="meeting" key={meeting.id}><div className="meeting-icon"><Clock3 size={19} /></div><div><strong>{meeting.title}</strong><small>{meeting.durationMinutes} min · {meeting.actionItemCount} action items</small></div></div>) : <p className="empty">Your completed meetings will appear here.</p>}
        </article>
      </section></>}
      {view === "requests" && <section className="panel-list"><p className="panel-intro">Accept a request to enter a private shared meeting room together.</p>{requests.length === 0 ? <div className="empty-state"><Bell size={28} /><h3>No meeting requests</h3><p>Return to the office and ask an available teammate to meet.</p></div> : requests.map((item) => <article className="request-row" key={item.id}><div className="avatar tone-2">{(item.direction === "incoming" ? item.senderName : item.recipientName).split(/\s+/).map((part) => part[0]).slice(0,2).join("")}</div><div><strong>{item.direction === "incoming" ? `${item.senderName} wants to meet` : `Request to ${item.recipientName}`}</strong><small>{item.message ?? "The Common Room"} · {item.status}</small></div>{item.status === "pending" && <div className="request-actions">{item.direction === "incoming" ? <><button className="accept" onClick={() => void respondToRequest(item,"accepted")}><Check size={16}/> Accept</button><button onClick={() => void respondToRequest(item,"declined")}><X size={16}/> Decline</button></> : <button onClick={() => void respondToRequest(item,"cancelled")}><X size={16}/> Cancel</button>}</div>}</article>)}</section>}
      {view === "notes" && <section className="panel-list">{meetings.length ? meetings.map((meeting) => <article className="note-detail" key={meeting.id}><div className="note-title"><div><p className="eyebrow">{new Date(meeting.occurredAt).toLocaleDateString()}</p><h3>{meeting.title}</h3></div><span>{meeting.durationMinutes} min</span></div><p>{meeting.summary}</p><div className="action-count"><Check size={16} /> {meeting.actionItemCount} proposed action items</div></article>) : <div className="empty-state"><History size={28} /><h3>No meeting notes yet</h3></div>}</section>}
    </main>
    {toast && <div className="toast"><Check size={17} /> {toast}</div>}
  </div>;
}
