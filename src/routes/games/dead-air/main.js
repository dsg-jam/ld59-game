import Peer from "peerjs";
import { describePeerError as sharedDescribePeerError, makeCode as sharedMakeCode } from "$lib/peer";
import {
  WORLD_W, WORLD_H, PLAYER_SPEED, PLAYER_COLORS, MAX_PLAYERS,
  TOWER_REQUIRED, REPAIR_RADIUS, WARM_X, WARM_Y, WARM_R, DARK_CHECK_RADIUS,
  VOTE_DURATION_MS, ELIM_COOLDOWN_MS, PLAYBACK_COOLDOWN_MS, SNIPPET_DURATION_MS,
  createDefaultTowers,
  assignRoles as engineAssignRoles,
  checkWinConditions as engineCheckWin,
  updateTowers as engineUpdateTowers,
  isIsolatedInDark as engineIsIsolated,
  resolveVote as engineResolveVote,
  clamp, dist,
} from "$lib/dead-air-engine";

(() => {
  // ── CONSTANTS ────────────────────────────────────────────────────────────────
  const PEER_PREFIX = 'dead-air-';
  const ROOM_CODE_LENGTH = 5;
  const VOICE_FREQ_NEAR = 3500;
  const VOICE_FREQ_MID = 800;
  const VOICE_FREQ_FAR = 200;
  const MIME_OPUS_WEBM = 'audio/webm;codecs=opus';
  const MIME_WEBM = 'audio/webm';
  const DEFAULT_OPERATIVE_RANGE = MAX_PLAYERS;

  const $ = id => document.getElementById(id);
  const canvas = $('map');
  const ctx = canvas.getContext('2d');

  // ── NETWORK + GAME STATE ─────────────────────────────────────────────────────
  let peer = null;
  let isHost = false;
  let hostId = null;
  let roomCode = '';
  let myId = null;
  let gameStarted = false;
  let localRole = null;
  let pendingRole = null;
  let myColor = PLAYER_COLORS[0];

  const players = new Map();
  const conns = new Map();
  const rolesById = new Map();
  const incomingRawStreams = new Map();

  let towers = createDefaultTowers();
  let voteState = null;
  let endState = null;

  let lastTowerBroadcast = 0;
  let lastHostSimTime = performance.now();
  let lastPositionSend = 0;
  let lastStateBroadcast = 0;
  let lastElimAt = -99999;
  let lastPlaybackAt = -99999;

  // ── INPUT + MOVEMENT ─────────────────────────────────────────────────────────
  const keys = new Set();

  // ── AUDIO PIPELINE ────────────────────────────────────────────────────────────
  let audioCtx = null;
  let micStream = null;
  let outgoingStream = null;
  let micDenied = false;
  const mediaCalls = new Map();
  const voicePipelines = new Map();
  let pinkNoiseBuffer = null;

  // ── MIMIC CAPTURE ─────────────────────────────────────────────────────────────
  const capturedSnippets = [];
  let activeCapture = null;

  function setWarn(msg = '') { $('warn').textContent = msg; }
  function setLobbyStatus(msg = '') { $('lobby-status').textContent = msg; }

  function makeCode() {
    return sharedMakeCode(ROOM_CODE_LENGTH);
  }

  function defaultName() {
    return `OPERATIVE-${1 + Math.floor(Math.random() * DEFAULT_OPERATIVE_RANGE)}`;
  }

  $('name').value = defaultName();

  function describePeerError(err) {
    return sharedDescribePeerError(err);
  }

  function updateNetDot(ok) {
    $('net-dot').classList.toggle('ok', !!ok);
  }

  function myPlayer() {
    return players.get(myId);
  }

  // ── PEER DATA CONNECTIONS ─────────────────────────────────────────────────────
  function resetNet() {
    for (const c of conns.values()) {
      try { c.close(); } catch (_) {}
    }
    conns.clear();
    for (const call of mediaCalls.values()) {
      try { call.close(); } catch (_) {}
    }
    mediaCalls.clear();
    incomingRawStreams.clear();
    voicePipelines.clear();
    if (peer) {
      try { peer.destroy(); } catch (_) {}
      peer = null;
    }
    updateNetDot(false);
  }

  function addConn(conn) {
    const pid = conn.peer;
    if (!pid || pid === myId) return;
    if (conns.has(pid)) return;
    conns.set(pid, conn);

    conn.on('open', () => {
      updateNetDot(true);
      if (gameStarted && players.has(pid)) {
        send(conn, { t: 'helloMesh', id: myId, name: $('name').value.slice(0, 16) || 'OPERATIVE' });
      }
    });

    conn.on('data', data => {
      handleData(data, pid);
    });

    conn.on('close', () => {
      conns.delete(pid);
      if (players.has(pid)) {
        const p = players.get(pid);
        p.alive = false;
        p.spectator = true;
      }
      renderSidebar();
    });
  }

  function send(conn, msg) {
    if (conn && conn.open) conn.send(msg);
  }

  function sendTo(id, msg) {
    send(conns.get(id), msg);
  }

  function broadcast(msg) {
    for (const c of conns.values()) send(c, msg);
  }

  function sendToHost(msg) {
    if (isHost) {
      handleHostMessage(msg, myId);
      return;
    }
    sendTo(hostId, msg);
  }

  function ensureMesh() {
    if (!peer || !gameStarted) return;
    const ids = [...players.keys()];
    for (const id of ids) {
      if (id === myId) continue;
      if (conns.has(id)) continue;
      if (myId < id) {
        const c = peer.connect(id, { reliable: true });
        addConn(c);
      }
    }
  }

  function setupPeerEvents() {
    peer.on('connection', conn => {
      addConn(conn);
    });

    peer.on('call', call => {
      call.answer(outgoingStream || undefined);
      attachCall(call, call.peer);
    });

    peer.on('error', err => {
      setLobbyStatus('Peer error: ' + describePeerError(err));
      setWarn('Network issue: ' + describePeerError(err));
    });
  }

  // ── LOBBY FLOW ────────────────────────────────────────────────────────────────
  function lobbySnapshot() {
    return [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive !== false,
    }));
  }

  function renderLobbyPlayers() {
    const wrap = $('lobby-players');
    wrap.innerHTML = '';
    const list = lobbySnapshot();
    if (!list.length) {
      wrap.innerHTML = '<div class="lp">No operators connected.</div>';
      return;
    }
    for (const p of list) {
      const d = document.createElement('div');
      d.className = 'lp';
      d.textContent = `${p.name}${p.id === myId ? ' (you)' : ''}`;
      wrap.appendChild(d);
    }
    if (isHost) {
      $('start-btn').disabled = list.length < 2 || list.length > MAX_PLAYERS;
    }
  }

  function syncLobby() {
    if (!isHost) return;
    const payload = { t: 'lobby', roomCode, hostId, players: lobbySnapshot() };
    broadcast(payload);
    renderLobbyPlayers();
  }

  function hostRoom() {
    resetNet();
    isHost = true;
    gameStarted = false;
    localRole = null;
    pendingRole = null;
    roomCode = makeCode();
    hostId = PEER_PREFIX + roomCode;
    setLobbyStatus('Opening room...');
    $('room-wrap').style.display = 'flex';
    $('room-code').textContent = roomCode;

    peer = new Peer(hostId);
    setupPeerEvents();

    peer.on('open', id => {
      myId = id;
      const name = ($('name').value || 'OPERATIVE').slice(0, 16);
      players.clear();
      rolesById.clear();
      towers = createDefaultTowers();
      players.set(myId, {
        id: myId,
        name,
        color: PLAYER_COLORS[0],
        x: WARM_X,
        y: WARM_Y,
        alive: true,
        spectator: false,
      });
      setLobbyStatus('Room live. Share code and wait for operators.');
      renderLobbyPlayers();
      syncLobby();
    });
  }

  function joinRoom() {
    resetNet();
    isHost = false;
    gameStarted = false;
    localRole = null;
    pendingRole = null;
    const code = $('join-code').value.trim().toUpperCase();
    if (!code) return setLobbyStatus('Enter room code.');
    roomCode = code;
    hostId = PEER_PREFIX + code;
    setLobbyStatus('Connecting to room...');

    peer = new Peer();
    setupPeerEvents();

    peer.on('open', id => {
      myId = id;
      const c = peer.connect(hostId, { reliable: true });
      addConn(c);
      c.on('open', () => {
        send(c, { t: 'helloJoin', name: ($('name').value || 'OPERATIVE').slice(0, 16) });
        setLobbyStatus('Connected. Waiting for host.');
      });
    });
  }

  function assignRoles() {
    const ids = [...players.keys()];
    const roles = engineAssignRoles(ids);
    rolesById.clear();
    for (const [id, role] of roles) {
      rolesById.set(id, role);
    }
  }

  function beginGame() {
    if (!isHost) return;
    if (players.size < 2 || players.size > MAX_PLAYERS) return;

    assignRoles();
    gameStarted = true;
    voteState = null;
    endState = null;
    towers = createDefaultTowers();

    let idx = 0;
    for (const p of players.values()) {
      p.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      p.x = WARM_X + (Math.cos(idx * 1.7) * 30);
      p.y = WARM_Y + (Math.sin(idx * 1.7) * 30);
      p.alive = true;
      p.spectator = false;
      idx++;
    }

    localRole = rolesById.get(myId);
    myColor = players.get(myId).color;

    for (const [id] of players) {
      if (id === myId) continue;
      sendTo(id, { t: 'rolePrivate', role: rolesById.get(id) });
    }

    const payloadPlayers = [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      alive: p.alive,
      spectator: p.spectator,
    }));

    broadcast({ t: 'start', hostId, players: payloadPlayers, towers });
    startLocalGame(payloadPlayers, towers);
  }

  function startLocalGame(seedPlayers, seedTowers) {
    $('lobby').style.display = 'none';
    $('game').style.display = 'block';
    towers = seedTowers.map(t => ({ ...t }));
    players.clear();
    for (const p of seedPlayers) players.set(p.id, { ...p });
    if (!players.has(myId)) {
      players.set(myId, {
        id: myId,
        name: ($('name').value || 'OPERATIVE').slice(0, 16),
        color: myColor,
        x: WARM_X,
        y: WARM_Y,
        alive: true,
        spectator: false,
      });
    }
    if (pendingRole) {
      localRole = pendingRole;
      pendingRole = null;
    }
    $('role-pill').textContent = `ROLE: ${localRole ? localRole.toUpperCase() : 'UNKNOWN'}`;
    $('role-pill').classList.toggle('bad', localRole === 'mimic');
    $('mimic-panel').style.display = localRole === 'mimic' ? 'block' : 'none';
    $('call-vote').disabled = false;
    $('status-pill').textContent = 'TRANSMISSION LIVE';

    ensureMesh();
    initMicrophone().then(() => beginVoiceCalls());

    renderSidebar();
    setWarn(micDenied ? 'Microphone denied. You can still play without outgoing voice.' : '');
  }

  // ── DATA MESSAGES ─────────────────────────────────────────────────────────────
  function handleData(msg, fromId) {
    if (!msg || typeof msg !== 'object') return;

    if (isHost) {
      handleHostMessage(msg, fromId);
      return;
    }

    switch (msg.t) {
      case 'lobby': {
        hostId = msg.hostId;
        roomCode = msg.roomCode;
        players.clear();
        for (const p of msg.players || []) {
          players.set(p.id, { id: p.id, name: p.name, color: '#888', x: WARM_X, y: WARM_Y, alive: p.alive, spectator: false });
        }
        renderLobbyPlayers();
        setLobbyStatus(`Joined ${roomCode}. Awaiting host start.`);
      } break;
      case 'rolePrivate': {
        pendingRole = msg.role;
        if (gameStarted) {
          localRole = pendingRole;
          pendingRole = null;
          $('role-pill').textContent = `ROLE: ${localRole ? localRole.toUpperCase() : 'UNKNOWN'}`;
          $('role-pill').classList.toggle('bad', localRole === 'mimic');
          $('mimic-panel').style.display = localRole === 'mimic' ? 'block' : 'none';
          renderSidebar();
        }
      } break;
      case 'start': {
        gameStarted = true;
        startLocalGame(msg.players || [], msg.towers || towers);
      } break;
      case 'helloMesh': {
        if (!players.has(fromId)) {
          players.set(fromId, { id: fromId, name: msg.name || 'OPERATIVE', color: '#888', x: WARM_X, y: WARM_Y, alive: true, spectator: false });
        }
      } break;
      case 'state': {
        applyAuthoritativeState(msg);
      } break;
      case 'towerSync': {
        towers = (msg.towers || []).map(t => ({ ...t }));
        renderSidebar();
      } break;
      case 'voteStarted': {
        voteState = { ...msg.vote, votes: msg.vote.votes || {} };
        renderVotePanel();
      } break;
      case 'voteUpdate': {
        if (!voteState) voteState = { active: true, endsAt: Date.now() + 15000, votes: {} };
        voteState.votes = msg.votes || {};
        renderVotePanel();
      } break;
      case 'playerEliminated': {
        const p = players.get(msg.id);
        if (p) {
          p.alive = false;
          p.spectator = true;
          if (msg.id === myId && outgoingStream) {
            for (const tr of outgoingStream.getAudioTracks()) tr.enabled = false;
          }
          renderSidebar();
        }
      } break;
      case 'mimicPlayback': {
        handleMimicPlayback(msg);
      } break;
      case 'warn': {
        setWarn(msg.text || '');
      } break;
      case 'gameOver': {
        showEnd(msg.winner, msg.roles || []);
      } break;
    }
  }

  function handleHostMessage(msg, fromId) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'helloJoin': {
        if (gameStarted) {
          sendTo(fromId, { t: 'warn', text: 'Match already started.' });
          return;
        }
        if (players.size >= MAX_PLAYERS) {
          sendTo(fromId, { t: 'warn', text: 'Room is full (max 6).' });
          return;
        }
        const name = (msg.name || 'OPERATIVE').slice(0, 16);
        const idx = players.size;
        players.set(fromId, {
          id: fromId,
          name,
          color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
          x: WARM_X,
          y: WARM_Y,
          alive: true,
          spectator: false,
        });
        syncLobby();
      } break;

      case 'updateName': {
        const p = players.get(fromId);
        if (p) p.name = (msg.name || p.name).slice(0, 16);
        syncLobby();
      } break;

      case 'pos': {
        if (!gameStarted) return;
        const p = players.get(fromId);
        if (!p || !p.alive) return;
        p.x = clamp(msg.x, 0, WORLD_W);
        p.y = clamp(msg.y, 0, WORLD_H);
      } break;

      case 'requestVote': {
        if (!gameStarted || voteState && voteState.active) return;
        const caller = players.get(fromId);
        if (!caller || !caller.alive) return;
        if (rolesById.get(fromId) === 'mimic') return;
        voteState = { active: true, endsAt: Date.now() + VOTE_DURATION_MS, votes: {}, caller: fromId };
        broadcast({ t: 'voteStarted', vote: voteState });
        renderVotePanel();
      } break;

      case 'castVote': {
        if (!voteState || !voteState.active) return;
        const voter = players.get(fromId);
        if (!voter || !voter.alive) return;
        if (rolesById.get(fromId) === 'mimic') return;
        if (!players.has(msg.target)) return;
        voteState.votes[fromId] = msg.target;
        broadcast({ t: 'voteUpdate', votes: voteState.votes });
      } break;

      case 'mimicElim': {
        if (!gameStarted) return;
        if (rolesById.get(fromId) !== 'mimic') return;
        const now = Date.now();
        if (now - lastElimAt < ELIM_COOLDOWN_MS) return;
        const targetId = msg.target;
        if (!targetId || !players.has(targetId)) return;
        const target = players.get(targetId);
        if (!target.alive || rolesById.get(targetId) === 'mimic') return;
        if (!isIsolatedInDark(targetId)) return;

        target.alive = false;
        target.spectator = true;
        lastElimAt = now;
        broadcast({ t: 'playerEliminated', id: targetId, reason: 'mimic' });
        checkWinConditions();
      } break;

      case 'mimicPlaybackRequest': {
        if (!gameStarted) return;
        if (rolesById.get(fromId) !== 'mimic') return;
        if (!msg.buffer || typeof msg.buffer.byteLength !== 'number') return;
        const now = Date.now();
        if (now - lastPlaybackAt < PLAYBACK_COOLDOWN_MS) return;
        const mimic = players.get(fromId);
        if (!mimic || !mimic.alive) return;
        lastPlaybackAt = now;
        const payload = { t: 'mimicPlayback', by: fromId, from: msg.from, x: mimic.x, y: mimic.y, buffer: msg.buffer };
        broadcast(payload);
        handleMimicPlayback(payload);
      } break;
    }
  }

  function applyAuthoritativeState(msg) {
    const snapshot = msg.players || [];
    for (const p of snapshot) {
      if (!players.has(p.id)) {
        players.set(p.id, { id: p.id, name: p.name || 'OPERATIVE', color: p.color || '#999', x: p.x, y: p.y, alive: p.alive, spectator: p.spectator });
      }
      const local = players.get(p.id);
      if (p.id !== myId) {
        local.x = p.x;
        local.y = p.y;
      }
      local.alive = p.alive;
      local.spectator = p.spectator;
      if (p.name) local.name = p.name;
      if (p.color) local.color = p.color;
    }
    towers = (msg.towers || towers).map(t => ({ ...t }));
    if (msg.vote) voteState = msg.vote.active ? msg.vote : null;
    renderSidebar();
  }

  // ── AUDIO HELPERS ────────────────────────────────────────────────────────────
  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      pinkNoiseBuffer = createPinkNoiseBuffer(audioCtx, 2.0);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  async function initMicrophone() {
    ensureAudioContext();
    micDenied = false;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      outgoingStream = micStream;
    } catch (_) {
      micDenied = true;
      outgoingStream = null;
      return;
    }
    if (localRole === 'mimic' && outgoingStream) {
      for (const tr of outgoingStream.getAudioTracks()) tr.enabled = false;
    }
  }

  function createPinkNoiseBuffer(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const out = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      out[i] = pink * 0.11;
    }
    return buffer;
  }

  function attachCall(call, sourceId) {
    mediaCalls.set(sourceId, call);
    call.on('stream', stream => {
      incomingRawStreams.set(sourceId, stream);
      attachVoicePipeline(sourceId, stream);
      renderMimicPanel();
    });
    call.on('close', () => {
      mediaCalls.delete(sourceId);
      incomingRawStreams.delete(sourceId);
      voicePipelines.delete(sourceId);
      renderMimicPanel();
    });
  }

  function beginVoiceCalls() {
    if (!peer) return;
    for (const id of players.keys()) {
      if (id === myId) continue;
      if (myId < id) {
        const call = peer.call(id, outgoingStream || undefined);
        if (call) attachCall(call, id);
      }
    }
  }

  function attachVoicePipeline(sourceId, stream) {
    if (!audioCtx) ensureAudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = VOICE_FREQ_NEAR;
    const gain = audioCtx.createGain();
    gain.gain.value = 1.0;

    const noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = pinkNoiseBuffer;
    noiseSrc.loop = true;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noiseSrc.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noiseSrc.start();

    voicePipelines.set(sourceId, { filter, gain, noiseGain, wobblePhase: Math.random() * Math.PI * 2 });
  }

  function applyDistanceNodes(filter, gain, noiseGain, dist, wobbleT) {
    let f = VOICE_FREQ_NEAR;
    let g = 1;
    let n = 0.01;
    if (dist > 350) {
      f = VOICE_FREQ_FAR;
      g = 0.1;
      n = 0.24;
      filter.detune.value = 0;
    } else if (dist > 150) {
      const t = (dist - 150) / 200;
      f = VOICE_FREQ_NEAR + (VOICE_FREQ_MID - VOICE_FREQ_NEAR) * t;
      g = 1 + (0.5 - 1) * t;
      n = 0.05 + 0.12 * t;
      filter.detune.value = Math.sin(wobbleT * 8) * 35;
    } else {
      filter.detune.value = 0;
    }
    filter.frequency.setTargetAtTime(Math.max(120, f), audioCtx.currentTime, 0.08);
    gain.gain.setTargetAtTime(g, audioCtx.currentTime, 0.08);
    noiseGain.gain.setTargetAtTime(n, audioCtx.currentTime, 0.1);
  }

  async function playDecodedBuffer(arrayBuffer, sourcePos) {
    if (!audioCtx) ensureAudioContext();
    try {
      const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const src = audioCtx.createBufferSource();
      src.buffer = decoded;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = VOICE_FREQ_NEAR;
      const gain = audioCtx.createGain();
      gain.gain.value = 1;
      const noiseSrc = audioCtx.createBufferSource();
      noiseSrc.buffer = pinkNoiseBuffer;
      noiseSrc.loop = true;
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noiseSrc.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      const local = myPlayer();
      if (local) {
        const d = dist(local.x, local.y, sourcePos.x, sourcePos.y);
        applyDistanceNodes(filter, gain, noiseGain, d, performance.now() * 0.001);
      }
      src.start();
      noiseSrc.start();
      src.onended = () => { try { noiseSrc.stop(); } catch (_) {} };
    } catch (_) {}
  }

  function handleMimicPlayback(msg) {
    if (!msg || !msg.buffer) return;
    playDecodedBuffer(msg.buffer, { x: msg.x, y: msg.y });
  }

  // ── MIMIC CAPTURE + PLAYBACK UI ──────────────────────────────────────────────
  function renderMimicPanel() {
    if (localRole !== 'mimic') return;
    const captureList = $('capture-list');
    captureList.innerHTML = '';
    const candidates = [...players.values()].filter(p => p.id !== myId && p.alive && rolesById.get(p.id) !== 'mimic');
    for (const p of candidates) {
      const streamReady = incomingRawStreams.has(p.id);
      const btn = document.createElement('button');
      btn.className = 'mini';
      btn.textContent = `⏺ CAPTURE ${p.name}${streamReady ? '' : ' (no signal yet)'}`;
      btn.disabled = !streamReady || !!activeCapture;
      btn.onclick = () => captureSnippet(p.id);
      captureList.appendChild(btn);
    }
    const snippetList = $('snippet-list');
    snippetList.innerHTML = '';
    for (let i = 0; i < capturedSnippets.length; i++) {
      const s = capturedSnippets[i];
      const b = document.createElement('button');
      b.className = 'snippet';
      b.textContent = `[${s.name}] 3s snippet`;
      b.disabled = Date.now() - lastPlaybackAt < PLAYBACK_COOLDOWN_MS;
      b.onclick = () => playSnippet(i);
      snippetList.appendChild(b);
    }
  }

  function captureSnippet(fromId) {
    const stream = incomingRawStreams.get(fromId);
    if (!stream || activeCapture) return;
    const person = players.get(fromId);
    const mime = MediaRecorder.isTypeSupported(MIME_OPUS_WEBM) ? MIME_OPUS_WEBM : MIME_WEBM;
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    activeCapture = rec;
    renderMimicPanel();
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      activeCapture = null;
      const blob = new Blob(chunks, { type: mime });
      const buffer = await blob.arrayBuffer();
      capturedSnippets.push({ fromId, name: person && person.name ? person.name : 'OPERATIVE', buffer });
      renderMimicPanel();
    };
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, SNIPPET_DURATION_MS);
  }

  function playSnippet(index) {
    const me = myPlayer();
    if (!me) return;
    if (Date.now() - lastPlaybackAt < PLAYBACK_COOLDOWN_MS) return;
    const snippet = capturedSnippets[index];
    if (!snippet) return;
    lastPlaybackAt = Date.now();
    sendToHost({ t: 'mimicPlaybackRequest', from: snippet.fromId, x: me.x, y: me.y, buffer: snippet.buffer });
    renderMimicPanel();
  }

  // ── GAME RULES ────────────────────────────────────────────────────────────────
  function isIsolatedInDark(targetId) {
    return engineIsIsolated(targetId, players, rolesById, towers);
  }

  function updateHostSimulation(now) {
    const dt = Math.min(0.25, (now - lastHostSimTime) / 1000);
    lastHostSimTime = now;
    engineUpdateTowers(towers, players, rolesById, dt);
    if (voteState && voteState.active && Date.now() >= voteState.endsAt) resolveVote();
    if (now - lastTowerBroadcast > 1000) {
      lastTowerBroadcast = now;
      broadcast({ t: 'towerSync', towers });
    }
    if (now - lastStateBroadcast > 100) {
      lastStateBroadcast = now;
      const snapshot = [...players.values()].map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        alive: p.alive,
        spectator: p.spectator,
      }));
      const vote = voteState && voteState.active ? { active: true, endsAt: voteState.endsAt, votes: voteState.votes || {} } : null;
      broadcast({ t: 'state', players: snapshot, towers, vote });
    }
    checkWinConditions();
  }

  function resolveVote() {
    if (!voteState || !voteState.active) return;
    const result = engineResolveVote(voteState, players, rolesById);
    if (!result.tie && result.eliminated) {
      const p = players.get(result.eliminated);
      if (p) {
        p.alive = false;
        p.spectator = true;
        broadcast({ t: 'playerEliminated', id: result.eliminated, reason: result.correct ? 'vote-correct' : 'vote-wrong' });
        if (result.correct) {
          endMatch('researchers');
        }
      }
    }
    voteState = null;
    renderVotePanel();
  }

  function checkWinConditions() {
    if (endState) return;
    const winner = engineCheckWin(players, rolesById, towers);
    if (winner) endMatch(winner);
  }

  function endMatch(winner) {
    if (endState) return;
    endState = { winner };
    const roles = [...players.values()].map(p => ({ id: p.id, name: p.name, role: rolesById.get(p.id) || (p.id === myId ? localRole : 'unknown') }));
    broadcast({ t: 'gameOver', winner, roles });
    showEnd(winner, roles);
  }

  function showEnd(winner, roles) {
    $('end').style.display = 'flex';
    $('end-title').textContent = winner === 'researchers' ? 'SIGNAL RESTORED' : 'THE MIMIC WINS';
    $('end-title').style.color = winner === 'researchers' ? 'var(--ok)' : 'var(--danger)';
    $('end-sub').textContent = winner === 'researchers' ? 'The outpost reconnects to the world.' : 'The relay falls silent in the storm.';
    $('status-pill').textContent = 'TRANSMISSION LOST';
    const ul = $('reveal');
    ul.innerHTML = '';
    for (const r of roles) {
      const li = document.createElement('li');
      li.textContent = `${r.name} — ${String(r.role || '').toUpperCase()}`;
      ul.appendChild(li);
    }
  }

  // ── RENDERING ────────────────────────────────────────────────────────────────
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width));
    const h = Math.max(200, Math.floor(rect.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function worldToCanvas(x, y) {
    const s = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
    const ox = (canvas.width - WORLD_W * s) * 0.5;
    const oy = (canvas.height - WORLD_H * s) * 0.5;
    return { x: ox + x * s, y: oy + y * s, s };
  }

  function drawMap(now) {
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const warm = worldToCanvas(WARM_X, WARM_Y);
    const s = warm.s;
    const warmGrad = ctx.createRadialGradient(warm.x, warm.y, 20 * s, warm.x, warm.y, WARM_R * s);
    warmGrad.addColorStop(0, 'rgba(255,184,0,0.42)');
    warmGrad.addColorStop(1, 'rgba(255,184,0,0)');
    ctx.fillStyle = warmGrad;
    ctx.beginPath();
    ctx.arc(warm.x, warm.y, WARM_R * s, 0, Math.PI * 2);
    ctx.fill();

    for (const t of towers) {
      const p = worldToCanvas(t.x, t.y);
      const ratio = Math.max(0, Math.min(1, t.progress / TOWER_REQUIRED));
      const litR = (70 + ratio * 170) * s;
      const g = ctx.createRadialGradient(p.x, p.y, 8 * s, p.x, p.y, litR);
      g.addColorStop(0, `rgba(120,255,220,${0.24 + ratio * 0.2})`);
      g.addColorStop(1, 'rgba(120,255,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, litR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#8fb3c0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 12 * s);
      ctx.lineTo(p.x - 10 * s, p.y + 9 * s);
      ctx.lineTo(p.x + 10 * s, p.y + 9 * s);
      ctx.closePath();
      ctx.stroke();

      const barW = 74 * s;
      const barH = 8 * s;
      const bx = p.x - barW / 2;
      const by = p.y - 28 * s;
      ctx.fillStyle = 'rgba(12,12,12,.8)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.strokeStyle = '#4f4a38';
      ctx.strokeRect(bx, by, barW, barH);
      ctx.fillStyle = ratio >= 1 ? '#44ff88' : '#ffb800';
      ctx.fillRect(bx + 1, by + 1, (barW - 2) * ratio, barH - 2);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.70)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out';

    const warmCut = ctx.createRadialGradient(warm.x, warm.y, 30 * s, warm.x, warm.y, 220 * s);
    warmCut.addColorStop(0, 'rgba(255,255,255,0.95)');
    warmCut.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = warmCut;
    ctx.beginPath();
    ctx.arc(warm.x, warm.y, 220 * s, 0, Math.PI * 2);
    ctx.fill();

    for (const t of towers) {
      const p = worldToCanvas(t.x, t.y);
      const ratio = Math.max(0, Math.min(1, t.progress / TOWER_REQUIRED));
      if (ratio <= 0) continue;
      const cut = ctx.createRadialGradient(p.x, p.y, 20 * s, p.x, p.y, (70 + ratio * 170) * s);
      cut.addColorStop(0, 'rgba(255,255,255,0.9)');
      cut.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cut;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (70 + ratio * 170) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    for (const p of players.values()) {
      const cp = worldToCanvas(p.x, p.y);
      const isMe = p.id === myId;
      const alive = p.alive;
      ctx.beginPath();
      ctx.fillStyle = alive ? (p.color || '#ddd') : '#6d6659';
      ctx.arc(cp.x, cp.y, 10 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isMe ? '#ffffffcc' : '#00000088';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `${Math.max(10, Math.floor(12 * s))}px JetBrains Mono`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isMe ? '#ffdf89' : '#d8ccb0';
      ctx.fillText(`${p.name}${isMe ? ' (you)' : ''}`, cp.x, cp.y - 14 * s);
    }

    if (voteState && voteState.active) {
      const remain = Math.max(0, Math.ceil((voteState.endsAt - Date.now()) / 1000));
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      ctx.fillRect(canvas.width / 2 - 110, 10, 220, 28);
      ctx.strokeStyle = '#52472c';
      ctx.strokeRect(canvas.width / 2 - 110, 10, 220, 28);
      ctx.fillStyle = '#ffb800';
      ctx.font = '12px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(`VOTE ACTIVE: ${remain}s`, canvas.width / 2, 28);
    }

    if (localRole === 'mimic') {
      const e = Math.max(0, Math.ceil((lastElimAt + ELIM_COOLDOWN_MS - Date.now()) / 1000));
      $('cooldown-pill').textContent = e > 0 ? `ELIM: ${e}s` : 'ELIM: READY';
    } else {
      $('cooldown-pill').textContent = 'ELIM: N/A';
    }

    if (audioCtx) {
      const me = myPlayer();
      if (me) {
        const t = now * 0.001;
        for (const [sourceId, pipe] of voicePipelines.entries()) {
          const srcPlayer = players.get(sourceId);
          if (!srcPlayer) continue;
          const d = dist(me.x, me.y, srcPlayer.x, srcPlayer.y);
          applyDistanceNodes(pipe.filter, pipe.gain, pipe.noiseGain, d, t + pipe.wobblePhase);
        }
      }
    }
  }

  function renderSidebar() {
    const ul = $('players');
    ul.innerHTML = '';
    for (const p of players.values()) {
      const li = document.createElement('li');
      li.className = `${p.id === myId ? 'you' : ''} ${p.alive ? '' : 'dead'}`;
      li.textContent = `${p.name}${p.id === myId ? ' (you)' : ''}`;
      ul.appendChild(li);
    }

    const tWrap = $('towers');
    tWrap.innerHTML = '';
    for (const t of towers) {
      const ratio = Math.max(0, Math.min(1, t.progress / TOWER_REQUIRED));
      const row = document.createElement('div');
      row.className = 'tower-row';
      row.innerHTML = `
        <div>Tower ${t.id} ${Math.round(ratio * 100)}%</div>
        <div class="bar"><div class="fill ${ratio >= 1 ? 'done' : ''}" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
      `;
      tWrap.appendChild(row);
    }

    renderVotePanel();
    renderMimicPanel();
  }

  function renderVotePanel() {
    const show = !!(voteState && voteState.active);
    $('vote-box').style.display = show ? 'block' : 'none';
    if (!show) return;
    const remain = Math.max(0, Math.ceil((voteState.endsAt - Date.now()) / 1000));
    $('vote-timer').textContent = `Time left: ${remain}s`;
    const list = $('vote-list');
    list.innerHTML = '';
    const me = myPlayer();
    const canVote = me && me.alive && localRole === 'researcher';
    const voted = voteState.votes && voteState.votes[myId];
    for (const p of players.values()) {
      if (!p.alive) continue;
      const b = document.createElement('button');
      b.textContent = voted === p.id ? `✓ ${p.name}` : p.name;
      b.disabled = !canVote;
      b.onclick = () => sendToHost({ t: 'castVote', target: p.id });
      list.appendChild(b);
    }
  }

  // ── UTILS ────────────────────────────────────────────────────────────────────
  // clamp & dist imported from dead-air-engine

  // ── MAIN LOOP ────────────────────────────────────────────────────────────────
  let lastFrame = performance.now();
  function loop(now) {
    const dt = Math.min(0.06, (now - lastFrame) / 1000);
    lastFrame = now;

    if ((gameStarted && !endState)) {
      const me = myPlayer();
      if (me && me.alive && !me.spectator) {
        let dx = 0;
        let dy = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
        if (dx || dy) {
          const l = Math.hypot(dx, dy) || 1;
          me.x = clamp(me.x + (dx / l) * PLAYER_SPEED * dt, 0, WORLD_W);
          me.y = clamp(me.y + (dy / l) * PLAYER_SPEED * dt, 0, WORLD_H);
        }
      }
      if (isHost) updateHostSimulation(now);
      if (now - lastPositionSend > 100) {
        lastPositionSend = now;
        const p = myPlayer();
        if (p) sendToHost({ t: 'pos', x: p.x, y: p.y });
      }
    }

    drawMap(now);
    requestAnimationFrame(loop);
  }

  // ── EVENTS ───────────────────────────────────────────────────────────────────
  $('host-btn').addEventListener('click', hostRoom);
  $('join-btn').addEventListener('click', joinRoom);
  $('start-btn').addEventListener('click', beginGame);

  $('name').addEventListener('change', () => {
    const name = ($('name').value || 'OPERATIVE').slice(0, 16);
    $('name').value = name;
    const me = players.get(myId);
    if (me) me.name = name;
    if (isHost) syncLobby();
    else sendToHost({ t: 'updateName', name });
    renderLobbyPlayers();
    renderSidebar();
  });

  $('call-vote').addEventListener('click', () => {
    const me = myPlayer();
    if (!me || !me.alive || localRole !== 'researcher') return;
    sendToHost({ t: 'requestVote' });
  });

  $('elim-btn').addEventListener('click', () => {
    if (localRole !== 'mimic') return;
    const targets = [...players.values()].filter(p => p.id !== myId && p.alive);
    if (!targets.length) return;
    const selected = targets.find(p => isHost ? isIsolatedInDark(p.id) : true) || targets[0];
    sendToHost({ t: 'mimicElim', target: selected.id });
  });

  $('play-again').addEventListener('click', () => location.reload());

  window.addEventListener('keydown', e => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => {
    keys.delete(e.code);
  });

  window.addEventListener('resize', resizeCanvas);
  renderLobbyPlayers();
  requestAnimationFrame(loop);
})();
