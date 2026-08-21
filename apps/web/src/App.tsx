import { useEffect, useState } from "react";
import { ArrowUpRight, Bell, Clock3, DoorOpen, History, Mic, Search, Users, Video } from "lucide-react";
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

  useEffect(() => {
    void fetch(`${apiUrl}/api/people`).then((r) => r.json()).then((data) => setPeople(data.people)).catch(() => undefined);
    void fetch(`${apiUrl}/api/meetings`).then((r) => r.json()).then((data) => setMeetings(data.meetings)).catch(() => undefined);
  }, []);

  async function invite(person: Person) {
    setSentTo(person.id);
    await fetch(`${apiUrl}/api/requests`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromId: "maya", toId: person.id, message: "Meet me in the Common Room?" })
    }).catch(() => undefined);
    window.setTimeout(() => setSentTo(undefined), 1800);
  }

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-mark"><DoorOpen size={19} /></span><span>Common Room</span></div>
      <nav>
        <button className="active"><Users size={18} /> Office</button>
        <button><Bell size={18} /> Requests <span className="badge">2</span></button>
        <button><History size={18} /> Meeting notes</button>
      </nav>
      <div className="profile"><div className="avatar cream">MC</div><div><strong>Maya Chen</strong><small><i className="dot available" /> Available</small></div></div>
    </aside>

    <main>
      <header><div><p className="eyebrow">FRIDAY, AUGUST 21</p><h1>Your office</h1></div><button className="icon-button"><Search size={20} /></button></header>

      <section className="hero">
        <div><span className="room-label"><i className="dot available" /> YOUR DOOR IS OPEN</span><h2>Ready when you are.</h2><p>People can ask to meet. You’ll always choose whether to join.</p></div>
        <button className="close-door"><DoorOpen size={18} /> Close my door</button>
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
        <article className="common-card"><div className="common-visual"><div className="table"><span /><span /><span /></div></div><div className="common-copy"><p className="eyebrow">SHARED SPACE</p><h3>The Common Room</h3><p>Meetings here are transcribed, summarized, and turned into clear next steps.</p><div className="features"><span><Video size={15} /> SignalWire video</span><span><Mic size={15} /> Automatic notes</span></div></div></article>
        <article className="notes-card"><div className="section-heading"><div><p className="eyebrow">RECENT</p><h3>Meeting notes</h3></div><button><ArrowUpRight size={18} /></button></div>
          {meetings.length ? meetings.map((meeting) => <div className="meeting" key={meeting.id}><div className="meeting-icon"><Clock3 size={19} /></div><div><strong>{meeting.title}</strong><small>{meeting.durationMinutes} min · {meeting.actionItemCount} action items</small></div></div>) : <p className="empty">Your completed meetings will appear here.</p>}
        </article>
      </section>
    </main>
  </div>;
}
