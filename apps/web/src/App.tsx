import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, ArrowUpRight, Bell, Check, DoorClosed, DoorOpen, History, ListChecks, Mic, MicOff, MonitorUp, Pencil, PhoneOff, Search, Trash2, Users, Video, VideoOff, X } from "lucide-react";
import type { ActionItem, MeetingSummary, Person } from "@office/contracts";
import type { IAgoraRTCClient, ICameraVideoTrack, ILocalVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";

const configuredApiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const apiUrl = configuredApiUrl && configuredApiUrl !== window.location.origin
  ? configuredApiUrl
  : window.location.hostname === "common-room-web.onrender.com" ? "https://common-room-api.onrender.com" : "";

interface SessionUser { id: string; email: string; displayName: string; title: string; isAdmin: boolean }
interface AuthStatus { mode: "demo" | "database"; requiresSetup?: boolean; user: SessionUser | null }
interface RequestView { id: string; senderId: string; recipientId: string; senderName: string; recipientName: string; message?: string; status: string; meetingId?: string; direction: "incoming" | "outgoing" }
interface RoomMember { id: string; name: string; audioMuted: boolean; videoMuted: boolean }

export function App() {
  const [people, setPeople] = useState<Person[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [sentTo, setSentTo] = useState<string>();
  const [doorOpen, setDoorOpen] = useState(true);
  const [doorSaving, setDoorSaving] = useState(false);
  const [view, setView] = useState<"office" | "requests" | "notes" | "actions" | "room">("office");
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [toast, setToast] = useState<string>();
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const agoraVideoRef = useRef<HTMLDivElement>(null);
  const screenVideoRef = useRef<HTMLDivElement>(null);
  const localMediaRef = useRef<MediaStream | null>(null);
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null);
  const roomUidRef = useRef<string | null>(null);
  const microphoneTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const cameraTrackRef = useRef<ICameraVideoTrack | null>(null);
  const screenTrackRef = useRef<ILocalVideoTrack | null>(null);
  const restoreCameraAfterShareRef = useRef(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [roomMode, setRoomMode] = useState<"loading" | "agora" | "local">("loading");
  const [auth, setAuth] = useState<AuthStatus>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState<string>();
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPerson, setNewPerson] = useState({ email: "", title: "" });
  const [inviteUrl, setInviteUrl] = useState<string>();
  const inviteToken = new URLSearchParams(window.location.search).get("invite");
  const [invitation, setInvitation] = useState<{ email: string; title: string }>();
  const [meetingId, setMeetingId] = useState("main");
  const [meetingTitle, setMeetingTitle] = useState("The Common Room");
  const [newMeetingTitle, setNewMeetingTitle] = useState("");
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [myActionItems, setMyActionItems] = useState<ActionItem[]>([]);
  const [noteSearch, setNoteSearch] = useState("");
  const [editingAction, setEditingAction] = useState<{ id: string; description: string; dueAt: string }>();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === "undefined" ? "denied" : Notification.permission);
  const knownRequestStatesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (inviteToken) void fetch(`${apiUrl}/api/invitations/${encodeURIComponent(inviteToken)}`).then(async (response) => { if (!response.ok) throw new Error((await response.json()).error); setInvitation(await response.json()); }).catch((error) => setAuthError(error.message));
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!auth?.user || inviteToken) return;
    let active = true;
    const refreshRealtime = async (announce: boolean) => {
      try {
        const options = { credentials: "include" as const };
        const [peopleResponse, requestsResponse, meetingsResponse, actionsResponse] = await Promise.all([fetch(`${apiUrl}/api/people`, options), fetch(`${apiUrl}/api/requests`, options), fetch(`${apiUrl}/api/meetings${noteSearch ? `?q=${encodeURIComponent(noteSearch)}` : ""}`, options), fetch(`${apiUrl}/api/action-items/mine`, options)]);
        if (!active) return;
        if (peopleResponse.ok) setPeople((await peopleResponse.json()).people);
        if (meetingsResponse.ok) setMeetings((await meetingsResponse.json()).meetings);
        if (actionsResponse.ok) setMyActionItems((await actionsResponse.json()).actionItems);
        if (requestsResponse.ok) {
          const nextRequests: RequestView[] = (await requestsResponse.json()).requests;
          if (announce) for (const item of nextRequests) {
            const previous = knownRequestStatesRef.current.get(item.id);
            if (!previous && item.direction === "incoming" && item.status === "pending") { showToast(`${item.senderName} wants to meet`); showBrowserNotification("Meeting request", `${item.senderName} wants to meet`, `request-${item.id}`); }
            if (previous === "pending" && item.direction === "outgoing" && item.status === "accepted") { showToast(`${item.recipientName} accepted — join from Requests`); showBrowserNotification("Invitation accepted", `${item.recipientName} accepted your meeting invitation`, `accepted-${item.id}`); }
          }
          knownRequestStatesRef.current = new Map(nextRequests.map((item) => [item.id, item.status]));
          setRequests(nextRequests);
        }
      } catch { /* keep the current snapshot and retry */ }
    };
    void refreshRealtime(false);
    const interval = window.setInterval(() => void refreshRealtime(true), 4000);
    return () => { active = false; window.clearInterval(interval); };
  }, [auth?.user?.id, inviteToken, noteSearch]);

  useEffect(() => {
    if (!auth?.user || view !== "notes") return;
    const timer = window.setTimeout(() => void loadMeetingNotes(noteSearch), 250);
    return () => window.clearTimeout(timer);
  }, [noteSearch, view, auth?.user?.id]);

  async function refreshSession() {
    try {
      const response = await fetch(`${apiUrl}/api/auth/status`, { credentials: "include" });
      if (!response.ok) throw new Error("API unavailable");
      const status: AuthStatus = await response.json();
      setAuth(status);
      if (status.user) await loadOfficeData(status.user.id);
    } catch { setAuthError("The Common Room API is unavailable. Check the web service API URL."); }
  }

  async function loadOfficeData(currentUserId = auth?.user?.id) {
    const options = { credentials: "include" as const };
    const [peopleResponse, meetingsResponse, requestsResponse, actionsResponse] = await Promise.all([fetch(`${apiUrl}/api/people`, options), fetch(`${apiUrl}/api/meetings`, options), fetch(`${apiUrl}/api/requests`, options), fetch(`${apiUrl}/api/action-items/mine`, options)]);
    if (peopleResponse.ok) {
      const loadedPeople: Person[] = (await peopleResponse.json()).people;
      setPeople(loadedPeople);
      const currentPerson = loadedPeople.find((person) => person.id === currentUserId);
      if (currentPerson) setDoorOpen(currentPerson.presence === "available");
    }
    if (meetingsResponse.ok) setMeetings((await meetingsResponse.json()).meetings);
    if (requestsResponse.ok) setRequests((await requestsResponse.json()).requests);
    if (actionsResponse.ok) setMyActionItems((await actionsResponse.json()).actionItems);
  }

  async function loadMeetingNotes(query: string) {
    const response = await fetch(`${apiUrl}/api/meetings${query ? `?q=${encodeURIComponent(query)}` : ""}`, { credentials: "include" });
    if (response.ok) setMeetings((await response.json()).meetings);
  }

  async function updateActionItem(item: ActionItem, changes: { description?: string; dueAt?: string | null; status?: ActionItem["status"] }) {
    const response = await fetch(`${apiUrl}/api/action-items/${item.id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error ?? "Unable to update the action item"); return; }
    setEditingAction(undefined);
    showToast(changes.status === "complete" ? "Action item completed" : changes.status === "dismissed" ? "Action item dismissed" : changes.status === "accepted" ? "Action item accepted" : "Action item updated");
    await loadOfficeData();
    if (noteSearch) await loadMeetingNotes(noteSearch);
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
    if (!response || !response.ok) { const body = response ? await response.json().catch(() => ({})) : {}; showToast(body.error ?? "The meeting request could not be sent"); setSentTo(undefined); return; }
    showToast(`Meeting request sent to ${person.name}`);
    await loadOfficeData();
    window.setTimeout(() => setSentTo(undefined), 1800);
  }

  async function deleteUser(person: Person) {
    if (!window.confirm(`Delete ${person.name}? Their access and active sessions will be removed immediately. Existing meeting notes will be preserved.`)) return;
    const response = await fetch(`${apiUrl}/api/users/${person.id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error ?? "Unable to delete the user"); return; }
    showToast(`${person.name} was deleted`);
    await loadOfficeData();
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2600);
  }

  function showBrowserNotification(title: string, body: string, tag: string) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => { window.focus(); setView("requests"); notification.close(); };
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") { showToast("Browser notifications are not supported here"); return; }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    showToast(permission === "granted" ? "Browser notifications enabled" : "Browser notifications were not enabled");
  }

  async function toggleDoor() {
    if (doorSaving) return;
    const next = !doorOpen;
    setDoorSaving(true);
    setDoorOpen(next);
    setPeople((current) => current.map((person) => person.id === auth?.user?.id ? { ...person, presence: next ? "available" : "do_not_disturb" } : person));
    showToast(next ? "Your door is now open" : "Your door is now closed");
    try {
      const response = await fetch(`${apiUrl}/api/presence`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ doorOpen: next }) });
      if (!response.ok) throw new Error("Presence update failed");
    } catch {
      setDoorOpen(!next);
      setPeople((current) => current.map((person) => person.id === auth?.user?.id ? { ...person, presence: !next ? "available" : "do_not_disturb" } : person));
      showToast("Your door status could not be saved");
    } finally { setDoorSaving(false); }
  }

  async function enterRoom(roomId = "main", title?: string) {
    setMeetingId(roomId);
    setView("room");
    setRoomMode("loading");
    void fetch(`${apiUrl}/api/presence`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "busy" }) });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${roomId}/token`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: auth?.user?.displayName, title: title?.trim() || undefined }) });
      if (!response.ok) throw new Error("Agora token unavailable");
      const { appId, token, channelName, uid, meetingId: trackedMeetingId, meetingTitle: trackedMeetingTitle, displayName: tokenDisplayName } = await response.json() as { appId: string; token: string; channelName: string; uid: string; meetingId: string; meetingTitle: string; displayName: string };
      setMeetingId(trackedMeetingId);
      setMeetingTitle(trackedMeetingTitle);
      setNewMeetingTitle("");
      const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      const memberName = (id: string) => people.find((person) => person.id === id)?.name ?? "Participant";
      const updateMember = (id: string, changes: Partial<RoomMember>) => setRoomMembers((current) => {
        const existing = current.find((member) => member.id === id);
        return [...current.filter((member) => member.id !== id), { id, name: existing?.name ?? memberName(id), audioMuted: existing?.audioMuted ?? true, videoMuted: existing?.videoMuted ?? true, ...changes }];
      });
      client.on("user-joined", (user) => updateMember(String(user.uid), {}));
      client.on("user-left", (user) => setRoomMembers((current) => current.filter((member) => member.id !== String(user.uid))));
      client.on("user-published", async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        const id = String(user.uid);
        if (mediaType === "audio") { user.audioTrack?.play(); updateMember(id, { audioMuted: false }); }
        if (mediaType === "video") {
          updateMember(id, { videoMuted: false });
          for (let attempt = 0; attempt < 20 && !document.getElementById(`remote-video-${id}`); attempt += 1) await new Promise((resolve) => window.setTimeout(resolve, 50));
          const target = document.getElementById(`remote-video-${id}`);
          if (target) user.videoTrack?.play(target, { fit: "cover" });
        }
      });
      client.on("user-unpublished", (user, mediaType) => updateMember(String(user.uid), mediaType === "audio" ? { audioMuted: true } : { videoMuted: true }));
      await client.join(appId, channelName, token, uid);
      const microphone = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish(microphone);
      const recordingResponse = await fetch(`${apiUrl}/api/meetings/${trackedMeetingId}/recording/start`, { method: "POST", credentials: "include" });
      const recordingResult = await recordingResponse.json().catch(() => ({})) as { status?: string; error?: string };
      if (!recordingResponse.ok || recordingResult.status === "failed" || recordingResult.status === "unavailable") showToast(recordingResult.error ?? "Automatic recording could not start.");
      agoraClientRef.current = client;
      roomUidRef.current = uid;
      microphoneTrackRef.current = microphone;
      setRoomMembers([{ id: uid, name: tokenDisplayName, audioMuted: false, videoMuted: true }]);
      setRoomMode("agora");
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localMediaRef.current = stream;
        setRoomMode("local");
        showToast("Agora was unavailable; showing a local device preview.");
      } catch {
        setCameraOn(false);
        setMicOn(false);
        setRoomMode("local");
        showToast("Camera access is unavailable; room opened without media.");
      }
    }
  }

  function leaveRoom() {
    const leavingMeetingId = meetingId;
    const client = agoraClientRef.current;
    const tracks = [microphoneTrackRef.current, cameraTrackRef.current, screenTrackRef.current].filter((track): track is IMicrophoneAudioTrack | ILocalVideoTrack => Boolean(track));
    if (client) void client.unpublish(tracks).catch(() => undefined).then(() => client.leave());
    screenTrackRef.current = null;
    tracks.forEach((track) => { track.stop(); track.close(); });
    agoraClientRef.current = null;
    roomUidRef.current = null;
    microphoneTrackRef.current = null;
    cameraTrackRef.current = null;
    restoreCameraAfterShareRef.current = false;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    localMediaRef.current?.getTracks().forEach((track) => track.stop());
    localMediaRef.current = null;
    setRoomMembers([]);
    setCameraOn(false);
    setScreenSharing(false);
    setMicOn(true);
    setView("office");
    void Promise.all([
      fetch(`${apiUrl}/api/presence`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: doorOpen ? "available" : "do_not_disturb" }) }),
      fetch(`${apiUrl}/api/meetings/${leavingMeetingId}/leave`, { method: "POST", credentials: "include" })
    ]).then(() => loadOfficeData()).catch(() => undefined);
  }

  async function toggleMicrophone() {
    const next = !micOn;
    if (roomMode === "agora" && microphoneTrackRef.current) {
      await microphoneTrackRef.current.setEnabled(next);
      setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, audioMuted: !next } : member));
    } else {
      localMediaRef.current?.getAudioTracks().forEach((track) => track.enabled = next);
    }
    setMicOn(next);
  }

  async function toggleCamera() {
    const next = !cameraOn;
    if (roomMode === "agora" && agoraClientRef.current) {
      if (next) {
        if (screenSharing) await stopScreenShare(false);
        try {
          const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
          const camera = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_1" });
          cameraTrackRef.current = camera;
          flushSync(() => setCameraOn(true));
          if (!agoraVideoRef.current) throw new Error("Local camera container was not mounted");
          camera.play(agoraVideoRef.current, { fit: "cover", mirror: true });
          await agoraClientRef.current.publish(camera);
          setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, videoMuted: false } : member));
        } catch (error) {
          console.error("Unable to start Agora camera", error);
          cameraTrackRef.current?.close();
          cameraTrackRef.current = null;
          setCameraOn(false);
          showToast("The camera could not be started. Check browser permissions.");
        }
        return;
      }
      const camera = cameraTrackRef.current;
      if (camera) { await agoraClientRef.current.unpublish(camera); camera.stop(); camera.close(); }
      cameraTrackRef.current = null;
      setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, videoMuted: true } : member));
    } else {
      if (next && !localMediaRef.current?.getVideoTracks().length) {
        const camera = await navigator.mediaDevices.getUserMedia({ video: true });
        const stream = localMediaRef.current ?? new MediaStream();
        camera.getVideoTracks().forEach((track) => stream.addTrack(track));
        localMediaRef.current = stream;
        setCameraOn(true);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (videoRef.current) videoRef.current.srcObject = stream;
        return;
      }
      localMediaRef.current?.getVideoTracks().forEach((track) => track.enabled = next);
      if (next) { setCameraOn(true); await new Promise((resolve) => window.setTimeout(resolve, 0)); if (videoRef.current) videoRef.current.srcObject = localMediaRef.current; return; }
    }
    setCameraOn(next);
  }

  async function stopScreenShare(restoreCamera: boolean) {
    const screen = screenTrackRef.current;
    if (!screen) return;
    screenTrackRef.current = null;
    await agoraClientRef.current?.unpublish(screen).catch(() => undefined);
    screen.stop();
    screen.close();
    setScreenSharing(false);
    setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, videoMuted: true } : member));
    const shouldRestoreCamera = restoreCamera && restoreCameraAfterShareRef.current;
    restoreCameraAfterShareRef.current = false;
    if (shouldRestoreCamera) {
      try {
        const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
        const camera = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_1" });
        cameraTrackRef.current = camera;
        flushSync(() => setCameraOn(true));
        if (agoraVideoRef.current) camera.play(agoraVideoRef.current, { fit: "cover", mirror: true });
        await agoraClientRef.current?.publish(camera);
        setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, videoMuted: false } : member));
      } catch { setCameraOn(false); showToast("Screen sharing stopped, but the camera could not be restored."); }
    }
  }

  async function toggleScreenShare() {
    if (roomMode !== "agora" || !agoraClientRef.current) { showToast("Screen sharing requires an Agora connection."); return; }
    if (screenSharing) { await stopScreenShare(true); return; }
    restoreCameraAfterShareRef.current = cameraOn;
    if (cameraTrackRef.current) {
      await agoraClientRef.current.unpublish(cameraTrackRef.current).catch(() => undefined);
      cameraTrackRef.current.stop();
      cameraTrackRef.current.close();
      cameraTrackRef.current = null;
      setCameraOn(false);
    }
    try {
      const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
      const screen = await AgoraRTC.createScreenVideoTrack({ encoderConfig: "1080p_1", optimizationMode: "detail" }, "disable");
      screenTrackRef.current = screen;
      screen.on("track-ended", () => void stopScreenShare(true));
      flushSync(() => setScreenSharing(true));
      if (screenVideoRef.current) screen.play(screenVideoRef.current, { fit: "contain", mirror: false });
      await agoraClientRef.current.publish(screen);
      setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, videoMuted: false } : member));
      showToast("Screen sharing started");
    } catch (error) {
      console.error("Unable to start screen sharing", error);
      screenTrackRef.current?.close();
      screenTrackRef.current = null;
      setScreenSharing(false);
      const restore = restoreCameraAfterShareRef.current;
      restoreCameraAfterShareRef.current = false;
      if (restore) {
        try {
          const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
          const camera = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_1" });
          cameraTrackRef.current = camera;
          flushSync(() => setCameraOn(true));
          if (agoraVideoRef.current) camera.play(agoraVideoRef.current, { fit: "cover", mirror: true });
          await agoraClientRef.current.publish(camera);
          setRoomMembers((current) => current.map((member) => member.id === roomUidRef.current ? { ...member, videoMuted: false } : member));
        } catch { setCameraOn(false); }
      }
      showToast("Screen sharing was cancelled or unavailable.");
    }
  }

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`${apiUrl}/api/invitations`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(newPerson) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error ?? "Unable to create invitation"); return; }
    const body = await response.json(); setInviteUrl(body.inviteUrl); showToast("Invite link created");
  }

  async function acceptInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteToken) return;
    const response = await fetch(`${apiUrl}/api/invitations/${encodeURIComponent(inviteToken)}/accept`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, password }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); setAuthError(body.error ?? "Unable to accept invitation"); return; }
    window.history.replaceState({}, "", "/"); setInvitation(undefined); await refreshSession();
  }

  async function respondToRequest(item: RequestView, status: "accepted" | "declined" | "cancelled") {
    const response = await fetch(`${apiUrl}/api/requests/${item.id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { showToast("Unable to update the request"); return; }
    const body = await response.json();
    await loadOfficeData();
    if (status === "accepted" && body.meetingId) await enterRoom(body.meetingId);
    else showToast(status === "cancelled" ? "Request cancelled" : `Request ${status}`);
  }

  async function dismissRequest(item: RequestView) {
    const response = await fetch(`${apiUrl}/api/requests/${item.id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) { showToast("The request could not be dismissed"); return; }
    setRequests((current) => current.filter((request) => request.id !== item.id));
    showToast("Request dismissed");
  }

  function renderActionItem(item: ActionItem, showMeeting = false) {
    const editing = editingAction?.id === item.id;
    const isAssignee = item.assigneeId === auth?.user?.id;
    const isUnassigned = !item.assigneeId;
    return <li className={`action-item status-${item.status}`} key={item.id}>
      {editing ? <form className="action-edit" onSubmit={(event) => { event.preventDefault(); void updateActionItem(item, { description: editingAction.description, dueAt: editingAction.dueAt ? new Date(`${editingAction.dueAt}T12:00:00`).toISOString() : null }); }}>
        <input value={editingAction.description} onChange={(event) => setEditingAction({ ...editingAction, description: event.target.value })} required maxLength={500} aria-label="Action item description" />
        <input type="date" value={editingAction.dueAt} onChange={(event) => setEditingAction({ ...editingAction, dueAt: event.target.value })} aria-label="Due date" />
        <button type="submit" className="primary">Save</button><button type="button" onClick={() => setEditingAction(undefined)}>Cancel</button>
      </form> : <><div className="action-copy"><strong>{item.description}</strong><small>{showMeeting ? `${item.meetingTitle}${item.meetingOccurredAt ? ` · ${new Date(item.meetingOccurredAt).toLocaleDateString()}` : ""} · ` : ""}{item.assigneeName ?? "Unassigned"}{item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}<span className="action-status">{item.status}</span></small></div><div className="action-buttons">
        {item.status === "proposed" && (isAssignee || isUnassigned) && <button className="primary" onClick={() => void updateActionItem(item, { status: "accepted" })}><Check size={14} /> {isUnassigned ? "Accept & assign to me" : "Accept"}</button>}
        {item.status === "accepted" && isAssignee && <button className="primary" onClick={() => void updateActionItem(item, { status: "complete" })}><Check size={14} /> Complete</button>}
        {item.status === "complete" && isAssignee && <button onClick={() => void updateActionItem(item, { status: "accepted" })}>Reopen</button>}
        {item.status !== "dismissed" && isAssignee && <button onClick={() => setEditingAction({ id: item.id, description: item.description, dueAt: item.dueAt ? item.dueAt.slice(0, 10) : "" })}><Pencil size={14} /> Edit</button>}
        {item.status !== "dismissed" && item.status !== "complete" && isAssignee && <button onClick={() => void updateActionItem(item, { status: "dismissed" })}><X size={14} /> Dismiss</button>}
      </div></>}
    </li>;
  }

  if (inviteToken) return <div className="auth-screen"><form className="auth-card" onSubmit={(event) => void acceptInvite(event)}><span className="brand-mark"><DoorOpen size={22} /></span><p className="eyebrow">YOU’RE INVITED</p><h1>Join Common Room</h1>{invitation ? <><p>Create your account for <strong>{invitation.email}</strong>{invitation.title ? ` as ${invitation.title}` : ""}.</p><label>Name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} autoComplete="name" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} autoComplete="new-password" /></label><button type="submit">Accept invitation</button></> : <p>{authError ?? "Checking your invitation…"}</p>}</form></div>;

  if (!auth?.user) return <div className="auth-screen"><form className="auth-card" onSubmit={(event) => void submitAuth(event)}><span className="brand-mark"><DoorOpen size={22} /></span><p className="eyebrow">COMMON ROOM</p><h1>{auth?.requiresSetup ? "Create the first account" : "Welcome back"}</h1><p>{auth?.requiresSetup ? "This account will be the administrator for your private workspace." : "Sign in to enter your company office."}</p>{auth?.requiresSetup && <label>Name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} autoComplete="name" /></label>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={auth?.requiresSetup ? 10 : undefined} autoComplete={auth?.requiresSetup ? "new-password" : "current-password"} /></label>{authError && <div className="auth-error">{authError}</div>}<button type="submit">{auth?.requiresSetup ? "Create workspace" : "Sign in"}</button></form></div>;

  if (view === "room") return <div className="room-screen">
    <div className="room-top"><button onClick={leaveRoom}><ArrowLeft size={18} /> Leave room</button><div><strong>{meetingTitle}</strong><small>{roomMode === "agora" ? "Connected through Agora" : roomMode === "loading" ? "Connecting…" : "Local device preview"}</small></div><span className="recording-pill">{roomMode === "agora" ? "Live" : "Preview"}</span></div>
    {(() => {
      const currentUserId = roomUidRef.current ?? auth.user.id;
      const displayMembers = roomMembers.length ? roomMembers : [{ id: auth.user.id, name: auth.user.displayName, audioMuted: !micOn, videoMuted: !cameraOn }];
      const hasRoomVideo = cameraOn || screenSharing || roomMembers.some((member) => !member.videoMuted);
      return <div className={`video-stage ${hasRoomVideo ? "has-video" : "audio-only"}`}>
        {hasRoomVideo && <div className="remote-video-grid">{displayMembers.filter((member) => member.id !== currentUserId && !member.videoMuted).map((member) => <div className="remote-video-tile" id={`remote-video-${member.id}`} key={member.id} />)}</div>}
        {!hasRoomVideo && <div className="audio-participants">{displayMembers.map((member, index) => <div className="audio-participant" key={member.id}><div className={`avatar tone-${index % 4}`}>{member.name.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase()}</div><strong>{member.name}</strong><span>{member.audioMuted ? <><MicOff size={13}/> Muted</> : <><Mic size={13}/> Listening</>}</span></div>)}</div>}
        {hasRoomVideo && <div className="participant-strip">{displayMembers.map((member, index) => <div key={member.id}><span className={`mini-avatar tone-${index % 4}`}>{member.name.split(/\s+/).map((part) => part[0]).slice(0,2).join("")}</span><small>{member.name}</small></div>)}</div>}
        {roomMode === "agora" && cameraOn && <div className="local-camera-preview" ref={agoraVideoRef} />}
        {roomMode === "agora" && screenSharing && <div className="local-screen-preview" ref={screenVideoRef} />}
        {roomMode === "local" && cameraOn && <video ref={videoRef} autoPlay muted playsInline />}
      </div>;
    })()}
    <div className="call-controls">
      <button className={!micOn ? "control-off" : ""} onClick={() => void toggleMicrophone()}>{micOn ? <Mic /> : <MicOff />}</button>
      <button className={!cameraOn ? "control-off" : ""} onClick={() => void toggleCamera()}>{cameraOn ? <Video /> : <VideoOff />}</button>
      <button className={screenSharing ? "sharing" : ""} onClick={() => void toggleScreenShare()} title={screenSharing ? "Stop sharing" : "Share screen"}><MonitorUp /></button>
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
        <button className={view === "actions" ? "active" : ""} onClick={() => setView("actions")}><ListChecks size={18} /> My action items {myActionItems.filter((item) => item.status !== "complete").length > 0 && <span className="badge">{myActionItems.filter((item) => item.status !== "complete").length}</span>}</button>
      </nav>
      <div className="profile"><div className="avatar cream">{auth.user.displayName.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase()}</div><div><strong>{auth.user.displayName}</strong><small><i className="dot available" /> Available</small></div></div>
    </aside>

    <main>
      {view !== "office" && <header><div><p className="eyebrow">COMMON ROOM</p><h1>{view === "requests" ? "Meeting requests" : view === "actions" ? "My action items" : "Meeting notes"}</h1></div><div className="header-actions">{view === "notes" ? <label className="note-search"><Search size={17} /><input value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} placeholder="Search notes and action items" aria-label="Search meeting notes" />{noteSearch && <button onClick={() => setNoteSearch("")} aria-label="Clear search"><X size={15} /></button>}</label> : null}{notificationPermission !== "granted" && <button className="notification-button" onClick={() => void enableNotifications()}><Bell size={16} /> Enable notifications</button>}</div></header>}

      {view === "office" && <><section className="room-grid"><section className={`hero ${doorOpen ? "" : "door-closed"}`}>
        <div><h2>My Office</h2><span className="room-label"><i className={`dot ${doorOpen ? "available" : "offline"}`} /> DOOR {doorOpen ? "OPEN" : "CLOSED"}</span></div>
        <button type="button" className="close-door" disabled={doorSaving} onClick={() => void toggleDoor()}>{doorOpen ? <DoorOpen size={18} /> : <DoorClosed size={18} />} {doorSaving ? "Saving…" : doorOpen ? "Close door" : "Open door"}</button>
      </section><article className="common-room-compact"><div><p className="eyebrow">SHARED SPACE</p><h3>The Common Room</h3><label className="meeting-title-input"><Mic size={14} /><input value={newMeetingTitle} onChange={(event) => setNewMeetingTitle(event.target.value)} maxLength={100} placeholder="Meeting title (optional)" /></label></div><button className="enter-room" onClick={() => void enterRoom("main", newMeetingTitle)}>Enter room <ArrowUpRight size={15} /></button></article></section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">THE TEAM</p><h3>Who’s around</h3></div><div className="heading-actions"><span>{people.filter((p) => p.presence === "available").length} available</span>{auth.user.isAdmin && <button onClick={() => setAddingPerson(!addingPerson)}>+ Add teammate</button>}</div></div>
        {addingPerson && <form className="add-person invite-form" onSubmit={(event) => void createInvite(event)}><input type="email" placeholder="Teammate email" value={newPerson.email} onChange={(event) => setNewPerson({...newPerson,email:event.target.value})} required /><input placeholder="Title (optional)" value={newPerson.title} onChange={(event) => setNewPerson({...newPerson,title:event.target.value})} /><button type="submit">Create invite link</button>{inviteUrl && <div className="invite-result"><input readOnly value={inviteUrl} /><button type="button" onClick={() => { void navigator.clipboard.writeText(inviteUrl); showToast("Invite link copied"); }}>Copy link</button></div>}</form>}
        <div className="people-grid">{people.length === 0 ? <div className="empty-state"><Users size={28} /><h3>No team members yet</h3><p>Invite management is the next account feature.</p></div> : people.map((person, index) => <article className="person-card" key={person.id}>
          <div className={`avatar tone-${index}`}>{person.initials}<i className={`presence-ring ${person.presence}`} /></div>
          <div className="person-info"><strong>{person.name}</strong><small>{person.title}{person.isAdmin ? " · Administrator" : ""}</small></div>
          <div className="person-actions"><button disabled={person.presence !== "available" || person.id === auth.user?.id} onClick={() => invite(person)}>
            {sentTo === person.id ? "Request sent" : person.presence === "available" ? "Ask to meet" : person.presence === "busy" ? "In a meeting" : "Away"}
          </button>{auth.user?.isAdmin && person.id !== auth.user?.id && <button className="delete-user" onClick={() => void deleteUser(person)} title={`Delete ${person.name}`}><Trash2 size={14} /> Delete</button>}</div>
        </article>)}</div>
      </section>

      <section className="section-block office-actions"><div className="section-heading"><div><p className="eyebrow">YOUR WORK</p><h3>Current action items</h3></div><button className="text-button" onClick={() => setView("actions")}>View all <ArrowUpRight size={14} /></button></div>{myActionItems.filter((item) => item.status !== "complete").length ? <ul className="action-items task-list">{myActionItems.filter((item) => item.status !== "complete").map((item) => renderActionItem(item, true))}</ul> : <div className="compact-empty"><Check size={18} /> You’re all caught up.</div>}</section></>}
      {view === "requests" && <section className="panel-list"><p className="panel-intro">Accept a request to enter a private shared meeting room together.</p>{requests.length === 0 ? <div className="empty-state"><Bell size={28} /><h3>No meeting requests</h3><p>Return to the office and ask an available teammate to meet.</p></div> : requests.map((item) => <article className="request-row" key={item.id}><div className="avatar tone-2">{(item.direction === "incoming" ? item.senderName : item.recipientName).split(/\s+/).map((part) => part[0]).slice(0,2).join("")}</div><div><strong>{item.direction === "incoming" ? `${item.senderName} wants to meet` : `Request to ${item.recipientName}`}</strong><small>{item.message ?? "The Common Room"} · {item.status}</small></div><div className="request-actions">{item.status === "pending" ? item.direction === "incoming" ? <><button className="accept" onClick={() => void respondToRequest(item,"accepted")}><Check size={16}/> Accept</button><button onClick={() => void respondToRequest(item,"declined")}><X size={16}/> Decline</button></> : <button onClick={() => void respondToRequest(item,"cancelled")}><X size={16}/> Cancel</button> : <>{item.status === "accepted" && item.meetingId && <button className="accept" onClick={() => void enterRoom(item.meetingId)}><Video size={16}/> Join</button>}<button onClick={() => void dismissRequest(item)}><X size={16}/> Dismiss</button></>}</div></article>)}</section>}
      {view === "notes" && <section className="panel-list">{meetings.length ? meetings.map((meeting) => <article className="note-detail" key={meeting.id}><div className="note-title"><div><p className="eyebrow">{new Date(meeting.occurredAt).toLocaleDateString()}</p><h3>{meeting.title}</h3></div><span>{meeting.durationMinutes} min</span></div><div className={`processing-status status-${meeting.processingStatus}`}>{({ not_started: "Not recorded", queued: "Waiting for recorder", starting: "Starting recorder", recording: "Recording", recorded: "Waiting for transcription", transcribing: "Transcribing", transcribed: "Waiting for AI analysis", summarizing: "Generating summary and action items", analyzed: "Notes ready", failed: "Processing failed" } as Record<string,string>)[meeting.processingStatus] ?? meeting.processingStatus}</div>{meeting.processingError ? <p className="processing-error">{meeting.processingError}</p> : null}<p className="meeting-summary">{meeting.summary}</p><div className="action-count"><Check size={16} /> {meeting.actionItemCount} action items</div>{meeting.actionItems?.length ? <ul className="action-items">{meeting.actionItems.map((item) => renderActionItem(item))}</ul> : null}</article>) : <div className="empty-state"><History size={28} /><h3>{noteSearch ? "No matching meeting notes" : "No meeting notes yet"}</h3>{noteSearch && <p>Try a different word or phrase.</p>}</div>}</section>}
      {view === "actions" && <section className="panel-list"><p className="panel-intro">Accept proposed work, adjust its wording or due date, and mark it complete when you’re done.</p>{myActionItems.length ? <ul className="action-items task-list">{myActionItems.map((item) => renderActionItem(item, true))}</ul> : <div className="empty-state"><ListChecks size={28} /><h3>No action items assigned to you</h3><p>Accepted proposals and assigned next steps will appear here.</p></div>}</section>}
    </main>
    {toast && <div className="toast"><Check size={17} /> {toast}</div>}
  </div>;
}
