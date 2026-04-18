import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { createGameLoop } from "$lib/game-loop";
import { describePeerError, makeCode } from "$lib/peer";

const PEER_PREFIX = 'sigweave-';
    const MAX_PLAYERS = 2;
    const PULSE_X_MIN = 0.2;
    const PULSE_X_SPAN = 0.6;
    const NETWORK_TICK_RATE = 0.05;
    const COMBO_TIMEOUT_SECONDS = 4;
    const PULSE_SYNC_WINDOW_SECONDS = 0.8;
    const OFFSET_MIN = 0;
    const OFFSET_MAX = 628;
    const OFFSET_SCALE = 100;
    const ARROW_KEY_STEP = 6;
    const ROOM_CODE_LENGTH = 5;
    const HARMONY_THRESHOLD = 0.18;
    const HARMONY_GAIN_RATE = 12;
    const $ = (id: string): HTMLElement => document.getElementById(id)!;
    const canvas = $('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;

    type Pulse = { owner: number; t: number; good: boolean };
    type GameSnapshot = {
      t: number;
      timeLeft: number;
      harmony: number;
      combo: number;
      offsets: number[];
      pulses: Pulse[];
      running: boolean;
      players: number;
    };
    type HostMsg = { t: 'offset'; v: number } | { t: 'ping' };
    type GuestMsg =
      | { t: 'hello'; slot: number }
      | { t: 'start' }
      | { t: 'state'; s: GameSnapshot }
      | { t: 'burst'; good: boolean }
      | { t: 'end'; harmony: string }
      | { t: 'reject'; reason?: string };

    let peer: Peer | null = null;
    let conn: DataConnection | null = null;
    let conns: (DataConnection | null)[] = [null];
    let isHost = false;
    let mySlot = -1;
    let roomCode = '';

    const state: {
      running: boolean;
      t: number;
      timeLeft: number;
      harmony: number;
      combo: number;
      offsets: [number, number];
      lastPing: [number, number];
      pulses: Pulse[];
      messages: string[];
      players: number;
    } = {
      running: false,
      t: 0,
      timeLeft: 90,
      harmony: 0,
      combo: 0,
      offsets: [0, Math.PI * 0.5],
      lastPing: [-99, -99],
      pulses: [], // {owner, t, good}
      messages: [],
      players: 1
    };
    let localSnapshot: GameSnapshot | null = null;

    function msg(text: string, kind = '') {
      const el = document.createElement('div');
      if (kind) el.className = kind;
      el.textContent = text;
      $('log').prepend(el);
      while ($('log').children.length > 20) $('log').removeChild($('log').lastChild!);
      $('status').textContent = text;
    }

    function flash(kind: string) {
      const f = $('flash');
      f.className = kind ? kind : '';
      f.style.opacity = kind ? '1' : '0';
      setTimeout(() => { f.style.opacity = '0'; }, 140);
    }

    function setLobbyStatus(t: string) { $('lobby-status').textContent = t; }

    function broadcast(data: unknown) {
      for (let i = 1; i < conns.length; i++) {
        const c = conns[i];
        if (c && c.open) c.send(data);
      }
    }

    function signalValue(t: number, offsets: number[]): number {
      return (Math.sin(t * 2.0 + (offsets[0] ?? 0)) + Math.sin(t * 2.7 + (offsets[1] ?? 0))) * 0.5;
    }
    function targetValue(t: number): number {
      return Math.sin(t * 1.5 + Math.sin(t * 0.4) * 1.2);
    }

    function hostTick(dt: number) {
      if (!state.running) return;
      state.t += dt;
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      const comboFactor = 1 + Math.min(5, state.combo) * 0.15;
      const diff = Math.abs(signalValue(state.t, state.offsets) - targetValue(state.t));

      if (diff < HARMONY_THRESHOLD) state.harmony += dt * HARMONY_GAIN_RATE * comboFactor;
      else state.harmony = Math.max(0, state.harmony - dt * 5);

      if (state.combo > 0 && state.t - Math.max(state.lastPing[0], state.lastPing[1]) > COMBO_TIMEOUT_SECONDS) state.combo = 0;
      state.pulses = state.pulses.filter(p => state.t - p.t < 2.4);

      if (state.timeLeft <= 0) {
        state.running = false;
        broadcast({ t: 'end', harmony: state.harmony.toFixed(1) });
        msg('Weave complete. Harmony: ' + state.harmony.toFixed(1));
      }
    }

    function hostSnapshot(): GameSnapshot {
      return {
        t: state.t,
        timeLeft: state.timeLeft,
        harmony: state.harmony,
        combo: state.combo,
        offsets: state.offsets,
        pulses: state.pulses,
        running: state.running,
        players: state.players
      };
    }

    function sendState() {
      const data = { t: 'state', s: hostSnapshot() };
      localSnapshot = data.s;
      broadcast(data);
    }

    function onPing(slot: number) {
      const now = state.t;
      state.lastPing[slot] = now;
      state.pulses.push({ owner: slot, t: now, good: false });
      const other = slot === 0 ? 1 : 0;
      if (state.players >= 2 && now - (state.lastPing[other] ?? -99) < PULSE_SYNC_WINDOW_SECONDS) {
        const aligned = Math.abs(signalValue(state.t, state.offsets) - targetValue(state.t)) < 0.2;
        if (aligned) {
          state.combo += 1;
          state.harmony += 16 + Math.min(state.combo, 6) * 2;
          state.pulses.push({ owner: slot, t: now, good: true });
          broadcast({ t: 'burst', good: true });
          flash('good');
          msg('Synchronized constructive pulse.', 'good');
        } else {
          state.combo = 0;
          state.harmony = Math.max(0, state.harmony - 6);
          broadcast({ t: 'burst', good: false });
          flash('bad');
          msg('Pulse collided out of phase.', 'bad');
        }
      } else if (state.players < 2) {
        msg('Awaiting second operator for synchronized pulse.');
      }
    }

    function startRound() {
      state.running = true;
      state.t = 0;
      state.timeLeft = 90;
      state.harmony = 0;
      state.combo = 0;
      state.pulses = [];
      state.lastPing = [-99, -99];
      sendState();
      broadcast({ t: 'start' });
      $('lobby').style.display = 'none';
      msg('Carrier locked. Weave active.');
    }

    function resetNet() {
      if (peer) {
        try { peer.destroy(); }
        catch { console.warn('Failed to cleanly destroy peer connection.'); }
      }
      peer = null; conn = null; conns = [null];
      isHost = false; mySlot = -1;
    }

    function hostGame() {
      if (typeof Peer === 'undefined') return setLobbyStatus('PeerJS failed to load.');
      resetNet();
      isHost = true;
      mySlot = 0;
      roomCode = makeCode(ROOM_CODE_LENGTH);
      state.players = 1;
      $('slot').textContent = 'P1';
      $('room-wrap').style.display = 'block';
      $('room-code').textContent = roomCode;
      ($('start-btn') as HTMLButtonElement).disabled = true;
      setLobbyStatus('Opening channel...');

      peer = new Peer(PEER_PREFIX + roomCode);
      peer.on('open', () => setLobbyStatus('Channel open. Waiting for operator 2.'));
      peer.on('connection', c => {
        if (state.players >= MAX_PLAYERS || state.running) {
          c.on('open', () => {
            c.send({ t: 'reject', reason: state.running ? 'Game already in progress.' : 'Room is full.' });
            c.close();
          });
          return;
        }
        conns[1] = c;
        c.on('open', () => {
          state.players = 2;
          c.send({ t: 'hello', slot: 1 });
          ($('start-btn') as HTMLButtonElement).disabled = false;
          setLobbyStatus('Operator connected. Ready to begin.');
          msg('Second operator tuned in.');
        });
        c.on('data', d => onHostMessage(d as HostMsg, 1));
        c.on('close', () => {
          state.players = 1;
          conns[1] = null;
          ($('start-btn') as HTMLButtonElement).disabled = true;
          setLobbyStatus('Operator disconnected.');
          msg('Peer disconnected.', 'bad');
        });
      });
      peer.on('error', e => setLobbyStatus('Host peer error: ' + describePeerError(e)));
    }

    function joinGame() {
      if (typeof Peer === 'undefined') return setLobbyStatus('PeerJS failed to load.');
      const code = ($('join-code') as HTMLInputElement).value.trim().toUpperCase();
      if (!code) return setLobbyStatus('Enter room code.');
      resetNet();
      setLobbyStatus('Tuning into ' + code + '...');
      peer = new Peer();
      peer.on('open', () => {
        conn = peer!.connect(PEER_PREFIX + code, { reliable: true });
        conn.on('open', () => setLobbyStatus('Connected. Awaiting host start.'));
        conn.on('data', d => onGuestMessage(d as GuestMsg));
        conn.on('close', () => setLobbyStatus('Disconnected from host.'));
      });
      peer.on('error', e => setLobbyStatus('Join peer error: ' + describePeerError(e)));
    }

    function onHostMessage(d: HostMsg, slot: number) {
      if (d.t === 'offset') {
        state.offsets[slot] = d.v;
      } else if (d.t === 'ping') {
        onPing(slot);
      }
    }

    function onGuestMessage(d: GuestMsg) {
      if (d.t === 'hello') {
        mySlot = d.slot;
        $('slot').textContent = 'P' + (mySlot + 1);
        setLobbyStatus('Linked as operator ' + (mySlot + 1) + '.');
      } else if (d.t === 'start') {
        $('lobby').style.display = 'none';
        msg('Host started the weave.');
      } else if (d.t === 'state') {
        localSnapshot = d.s;
      } else if (d.t === 'burst') {
        flash(d.good ? 'good' : 'bad');
        msg(d.good ? 'Synchronized constructive pulse.' : 'Pulse collided out of phase.', d.good ? 'good' : 'bad');
      } else if (d.t === 'end') {
        msg('Weave complete. Harmony: ' + d.harmony);
      } else if (d.t === 'reject') {
        setLobbyStatus(d.reason ?? 'Unable to join room.');
      }
    }

    $('host-btn').onclick = hostGame;
    $('join-btn').onclick = joinGame;
    $('start-btn').onclick = () => { if (isHost && state.players >= 2) startRound(); };

    ($('offset') as HTMLInputElement).addEventListener('input', () => {
      const v = Number(($('offset') as HTMLInputElement).value) / OFFSET_SCALE;
      $('offset-label').textContent = v.toFixed(2) + ' rad';
      if (mySlot < 0 && isHost) mySlot = 0;
      if (isHost) {
        state.offsets[0] = v;
      } else if (conn && conn.open) {
        conn.send({ t: 'offset', v });
      }
    });

    function doPulse() {
      if (isHost) onPing(0);
      else if (conn && conn.open) conn.send({ t: 'ping' });
    }
    $('pulse-btn').onclick = doPulse;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); doPulse(); }
      if (e.code === 'ArrowLeft') { ($('offset') as HTMLInputElement).value = String(Math.max(OFFSET_MIN, Number(($('offset') as HTMLInputElement).value) - ARROW_KEY_STEP)); $('offset').dispatchEvent(new Event('input')); }
      if (e.code === 'ArrowRight') { ($('offset') as HTMLInputElement).value = String(Math.min(OFFSET_MAX, Number(($('offset') as HTMLInputElement).value) + ARROW_KEY_STEP)); $('offset').dispatchEvent(new Event('input')); }
    });

    let netTimer = 0;
    const gameLoop = createGameLoop((dt) => {
      if (isHost) {
        hostTick(dt);
        netTimer += dt;
        if (netTimer > NETWORK_TICK_RATE) { sendState(); netTimer = 0; }
      }
      draw(localSnapshot ?? hostSnapshot());
    });

    function draw(snapshot: GameSnapshot) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.clearRect(0, 0, w, h);

      const midY = h * 0.5;
      const left = 30, right = w - 30, span = right - left;
      const amp = h * 0.22;
      const s = snapshot;
      const now = s.t || 0;

      ctx.strokeStyle = '#1f2d56'; ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const y = midY - amp + (amp * 2 * i / 8);
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      }

      function drawWave(fn: (t: number) => number, color: string, width = 2, alpha = 1) {
        ctx.beginPath();
        for (let i = 0; i <= 240; i++) {
          const x = left + span * (i / 240);
          const t = now - 3 + (i / 240) * 6;
          const y = midY - fn(t) * amp;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const offs = s.offsets;
      drawWave((t) => targetValue(t), '#ff7ccf', 2.5, 0.95);
      drawWave((t) => signalValue(t, offs), '#79f3ff', 2.5, 0.95);
      drawWave((t) => Math.sin(t * 2.0 + (offs[0] ?? 0)), '#8ef9ff', 1.2, 0.35);
      drawWave((t) => Math.sin(t * 2.7 + (offs[1] ?? 0)), '#6bb4ff', 1.2, 0.35);

      const pulses = s.pulses;
      // Map owner slot to 0..1; keep denominator at least 1 for solo/local snapshots.
      const playerCount = Math.max(1, (s.players ?? 1));
      const playerDenom = playerCount > 1 ? (playerCount - 1) : 1;
      for (const p of pulses) {
        const age = now - p.t;
        const ownerNorm = (p.owner || 0) / playerDenom;
        const x = w * (PULSE_X_MIN + PULSE_X_SPAN * ownerNorm);
        const r = 20 + age * 120;
        ctx.beginPath();
        ctx.arc(x, midY, r, 0, Math.PI * 2);
        ctx.strokeStyle = p.good ? 'rgba(141,255,157,' + (1 - age / 2.4).toFixed(3) + ')' : 'rgba(121,243,255,' + (1 - age / 2.4).toFixed(3) + ')';
        ctx.lineWidth = p.good ? 3 : 1.5;
        ctx.stroke();
      }

      $('time').textContent = (s.timeLeft || 0).toFixed(1);
      $('harmony').textContent = (s.harmony || 0).toFixed(1);
      $('combo').textContent = 'x' + (s.combo || 0);
      if (mySlot >= 0) $('slot').textContent = 'P' + (mySlot + 1);
    }

    ($('offset') as HTMLInputElement).min = String(OFFSET_MIN);
    ($('offset') as HTMLInputElement).max = String(OFFSET_MAX);
    $('offset').dispatchEvent(new Event('input'));
    gameLoop.start();
