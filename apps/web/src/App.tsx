import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bell, Check, Clock3, DoorClosed, DoorOpen, History, Mic, MicOff, PhoneOff, Search, Users, Video, VideoOff, X } from "lucide-react";
import type { MeetingSummary, Person } from "@office/contracts";

const fallbackPeople: Person[] = [
  { id: "maya", name: "Maya Chen", initials: "MC", title: "Product", presence: "available" },
  { id: "jon", name: "Jon Bell", initials: "JB", title: "Engineering", presence: "busy" },
  { id: "priya", name: "Priya Shah", initials: "PS", title: "Design", presence: "available" },
  { id: "theo", name: "Theo Martin", initials: "TM", title: "Operations", presence: "offline" }
];

const apiUrl = import.meta.env.VITE_API_URL ?? "";

export function App() {
  const [people, setPeople] = useState(fallbackPeople);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [sentTo, setSentTo] = useState<string>();
  const [doorOpen, setDoorOpen] = useState(true);
  const [view, setView] = useState<"office" | "requests" | "notes" | "room">("office");
  const [outgoing, setOutgoing] = useState<Person[]>([]);
  const [toast, setToast] = useState<string>();
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void fetch(`${apiUrl}/api/people`).then((r) => r.json()).then((data) => setPeople(data.people)).catch(() => undefined);
    void fetch(`${apiUrl}/api/meetings`).then((r) => r.json()).then((data) => setMeetings(data.meetings)).catch(() => undefined);
  }, []);

  async function invite(person: Person) {
    setSentTo(person.id);
    setOutgoing((current) => current.some((item) => item.id === person.id) ? current : [person, ...current]);
    showToast(`Meeting request sent to ${person.name}`);
    await fetch(`${apiUrl}/api/requests`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromId: "maya", toId: person.id, message: "Meet me in the Common Room?" })
    }).catch(() => undefined);
    window.setTimeout(() => setSentTo(undefined), 1800);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2600);
  }

  async function enterRoom() {
    setView("room");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraOn(false);
      setMicOn(false);
      showToast("Camera access is unavailable; room preview opened without media.");
    }
  }

  function leaveRoom() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    setView("office");
  }

  if (view === "room") return <div className="room-screen">
    <div className="room-top"><button onClick={leaveRoom}><ArrowLeft size={18} /> Leave preview</button><div><strong>The Common Room</strong><small>Local device preview</small></div><span className="recording-pill">SignalWire not connected</span></div>
    <div className="video-stage">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-off"><div className="avatar tone-0">MC</div><span>Camera is off</span></div>}</div>
    <div className="call-controls">
      <button className={!micOn ? "control-off" : ""} onClick={() => { setMicOn(!micOn); const stream = videoRef.current?.srcObject as MediaStream | null; stream?.getAudioTracks().forEach((track) => track.enabled = !micOn); }}>{micOn ? <Mic /> : <MicOff />}</button>
      <button className={!cameraOn ? "control-off" : ""} onClick={() => { setCameraOn(!cameraOn); const stream = videoRef.current?.srcObject as MediaStream | null; stream?.getVideoTracks().forEach((track) => track.enabled = !cameraOn); }}>{cameraOn ? <Video /> : <VideoOff />}</button>
      <button className="hangup" onClick={leaveRoom}><PhoneOff /></button>
    </div>
  </div>;

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-mark"><DoorOpen size={19} /></span><span>Common Room</span></div>
      <nav>
        <button className={view === "office" ? "active" : ""} onClick={() => setView("office")}><Users size={18} /> Office</button>
        <button className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}><Bell size={18} /> Requests {outgoing.length > 0 && <span className="badge">{outgoing.length}</span>}</button>
        <button className={view === "notes" ? "active" : ""} onClick={() => setView("notes")}><History size={18} /> Meeting notes</button>
      </nav>
      <div className="profile"><div className="avatar cream">MC</div><div><strong>Maya Chen</strong><small><i className="dot available" /> Available</small></div></div>
    </aside>

    <main>
      <header><div><p className="eyebrow">FRIDAY, AUGUST 21</p><h1>{view === "office" ? "Your office" : view === "requests" ? "Meeting requests" : "Meeting notes"}</h1></div><button className="icon-button" onClick={() => showToast("Search is coming in the next slice.")}><Search size={20} /></button></header>

      {view === "office" && <><section className={`hero ${doorOpen ? "" : "door-closed"}`}>
        <div><span className="room-label"><i className={`dot ${doorOpen ? "available" : "offline"}`} /> YOUR DOOR IS {doorOpen ? "OPEN" : "CLOSED"}</span><h2>{doorOpen ? "Ready when you are." : "Taking some focus time."}</h2><p>{doorOpen ? "People can ask to meet. You’ll always choose whether to join." : "New meeting requests are paused until you open your door."}</p></div>
        <button className="close-door" onClick={() => { setDoorOpen(!doorOpen); showToast(doorOpen ? "Your door is now closed" : "Your door is now open"); }}>{doorOpen ? <DoorOpen size={18} /> : <DoorClosed size={18} />} {doorOpen ? "Close my door" : "Open my door"}</button>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">THE TEAM</p><h3>Who’s around</h3></div><span>{people.filter((p) => p.presence === "available").length} available</span></div>
        <div className="people-grid">{people.map((person, index) => <article className="person-card" key={person.id}>
          <div className={`avatar tone-${index}`}>{person.initials}<i className={`presence-ring ${person.presence}`} /></div>
          <div className="person-info"><strong>{person.name}</strong><small>{person.title}</small></div>
          <button disabled={person.presence !== "available" || person.id === "maya"} onClick={() => invite(person)}>
            {sentTo === person.id ? "Request sent" : person.presence === "available" ? "Ask to meet" : person.presence === "busy" ? "In a meeting" : "Away"}
          </button>
        </article>)}</div>
      </section>

      <section className="lower-grid">
        <article className="common-card"><div className="common-visual"><div className="table"><span /><span /><span /></div></div><div className="common-copy"><p className="eyebrow">SHARED SPACE</p><h3>The Common Room</h3><p>Meetings here are transcribed, summarized, and turned into clear next steps.</p><div className="features"><span><Video size={15} /> SignalWire video</span><span><Mic size={15} /> Automatic notes</span></div><button className="enter-room" onClick={() => void enterRoom()}>Preview meeting room</button></div></article>
        <article className="notes-card"><div className="section-heading"><div><p className="eyebrow">RECENT</p><h3>Meeting notes</h3></div><button><ArrowUpRight size={18} /></button></div>
          {meetings.length ? meetings.map((meeting) => <div className="meeting" key={meeting.id}><div className="meeting-icon"><Clock3 size={19} /></div><div><strong>{meeting.title}</strong><small>{meeting.durationMinutes} min · {meeting.actionItemCount} action items</small></div></div>) : <p className="empty">Your completed meetings will appear here.</p>}
        </article>
      </section></>}
      {view === "requests" && <section className="panel-list"><p className="panel-intro">Requests you send will stay here until they are accepted, declined, or cancelled.</p>{outgoing.length === 0 ? <div className="empty-state"><Bell size={28} /><h3>No meeting requests</h3><p>Return to the office and ask an available teammate to meet.</p></div> : outgoing.map((person) => <article className="request-row" key={person.id}><div className="avatar tone-2">{person.initials}</div><div><strong>Waiting for {person.name}</strong><small>Sent just now · The Common Room</small></div><button onClick={() => { setOutgoing((items) => items.filter((item) => item.id !== person.id)); showToast("Request cancelled"); }}><X size={16} /> Cancel</button></article>)}</section>}
      {view === "notes" && <section className="panel-list">{meetings.length ? meetings.map((meeting) => <article className="note-detail" key={meeting.id}><div className="note-title"><div><p className="eyebrow">{new Date(meeting.occurredAt).toLocaleDateString()}</p><h3>{meeting.title}</h3></div><span>{meeting.durationMinutes} min</span></div><p>{meeting.summary}</p><div className="action-count"><Check size={16} /> {meeting.actionItemCount} proposed action items</div></article>) : <div className="empty-state"><History size={28} /><h3>No meeting notes yet</h3></div>}</section>}
    </main>
    {toast && <div className="toast"><Check size={17} /> {toast}</div>}
  </div>;
}
