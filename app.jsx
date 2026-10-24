import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import QRCode from "qrcode";

const W = 1280,
  H = 720,
  BAND = 280,
  GY = 626,
  M = Math.max,
  HI = 0.75,
  MATCH_T = 30,
  COL = ["#5fe9ff", "#ff4fa3"];
// Two gestures per action so anyone can play. No eyebrow gestures.
/* ---------- sound (WebAudio synth, no files) ---------- */
const SFX = (() => {
  let ac, out, mus, nbuf;
  // one shared audio graph: everything -> compressor (no harsh peaks);
  // music goes through its own softer low-pass bus
  const A = () => {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      out = ac.createGain();
      out.gain.value = 0.9;
      out.connect(comp);
      comp.connect(ac.destination);
      mus = ac.createGain();
      mus.gain.value = 0.55;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      mus.connect(lp);
      lp.connect(out);
      nbuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  };
  // soft attack (no clicks) + smooth decay
  const tone = (f, d, type = "sine", v = 0.07, f2, at = 0, bus) => {
    if (SFX.mute) return;
    try {
      const a = A(),
        t = a.currentTime + at,
        o = a.createOscillator(),
        g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g);
      g.connect(bus === "m" ? mus : out);
      o.start(t);
      o.stop(t + d + 0.02);
    } catch {}
  };
  // filtered noise burst: whooshes, thumps, snares, hats
  const noise = (d, v, f, f2, type = "bandpass", at = 0, bus, q = 1) => {
    if (SFX.mute) return;
    try {
      const a = A(),
        t = a.currentTime + at,
        s = a.createBufferSource(),
        fl = a.createBiquadFilter(),
        g = a.createGain();
      s.buffer = nbuf;
      fl.type = type;
      fl.Q.value = q;
      fl.frequency.setValueAtTime(f, t);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      s.connect(fl);
      fl.connect(g);
      g.connect(bus === "m" ? mus : out);
      s.start(t, Math.random() * 0.5);
      s.stop(t + d + 0.02);
    } catch {}
  };
  let mt = null,
    st = 0;
  const bass = [55, 55, 82, 55, 65, 65, 98, 73],
    lead = [330, 392, 494, 392, 440, 523, 440, 392];
  return {
    mute: false,
    music: (on) => {
      clearInterval(mt);
      mt = null;
      if (!on) return;
      mt = setInterval(() => {
        if (SFX.mute) return;
        const n = st++ % 16;
        if (n % 4 === 0) {
          tone(150, 0.22, "sine", 0.3, 42, 0, "m"); // kick
        }
        if (n % 8 === 4) {
          noise(0.14, 0.09, 1800, 0, "bandpass", 0, "m", 0.8); // snare
          tone(190, 0.08, "triangle", 0.05, 120, 0, "m");
        }
        if (n % 2 === 1) noise(0.04, 0.025, 8000, 0, "highpass", 0, "m"); // hat
        if (n % 2 === 0) {
          const b = bass[(n >> 1) & 7];
          tone(b, 0.22, "triangle", 0.1, 0, 0, "m");
          tone(b * 2, 0.18, "sine", 0.035, 0, 0, "m");
        }
        if (n % 2 === 0) tone(lead[(n >> 1) % 8], 0.16, "sine", 0.03, 0, 0, "m");
      }, 115);
    },
    count: () => {
      tone(440, 0.18, "triangle", 0.08);
      tone(880, 0.1, "sine", 0.03);
    },
    go: () => {
      [523, 659, 784].forEach((f, i) =>
        tone(f, 0.45, "triangle", 0.07, 0, i * 0.06),
      );
      tone(1568, 0.5, "sine", 0.03, 0, 0.12);
      noise(0.3, 0.05, 600, 3000, "bandpass");
    },
    swing: () => noise(0.14, 0.07, 700, 2600, "bandpass", 0, undefined, 0.7),
    hit: (b) => {
      tone(b ? 130 : 180, 0.2, "sine", 0.22, 45); // body thump
      noise(0.12, b ? 0.16 : 0.11, b ? 900 : 1400, 200, "lowpass"); // impact
      tone(b ? 700 : 520, 0.05, "square", 0.025, 150); // crack
    },
    block: () => {
      tone(1760, 0.22, "triangle", 0.05, 1500);
      tone(2637, 0.18, "sine", 0.03, 2300, 0.015);
      noise(0.05, 0.05, 5000, 0, "highpass");
    },
    fire: () => {
      noise(0.5, 0.11, 300, 2200, "bandpass", 0, undefined, 0.9);
      tone(220, 0.5, "sawtooth", 0.035, 700);
      tone(110, 0.45, "sine", 0.1, 60);
    },
    ko: () => {
      tone(320, 0.8, "sine", 0.2, 38);
      noise(0.3, 0.14, 1200, 150, "lowpass");
      tone(200, 0.7, "triangle", 0.05, 50, 0.12);
    },
    win: () => {
      [523, 659, 784, 1046].forEach((f, i) => {
        tone(f, 0.35, "triangle", 0.07, 0, i * 0.12);
        tone(f * 2, 0.3, "sine", 0.02, 0, i * 0.12);
      });
      [523, 659, 784].forEach((f) => tone(f, 0.8, "triangle", 0.045, 0, 0.5));
    },
  };
})();
const F = {
  wink: (b) => {
    const l = b.eyeBlinkLeft || 0,
      r = b.eyeBlinkRight || 0;
    return M(l, r) > 0.45 ? Math.abs(l - r) / 0.5 : 0;
  },
  kiss: (b) => (b.mouthPucker || 0) / 0.6,
  mouth: (b) => (b.jawOpen || 0) / 0.4,
  wide: (b) => ((b.eyeWideLeft || 0) + (b.eyeWideRight || 0)) / 1,
  tongue: (b) => {
    const p = Math.max(b.mouthPucker || 0, (b.mouthFunnel || 0) * 0.8),
      j = b.jawOpen || 0;
    return j > 0.4 ? 0 : p / 0.45;
  },
  puff: (b) => (b.cheekPuff || 0) / 0.4,
};
const ACT = {
  atk: ["wink", "kiss"],
  def: ["mouth", "wide"],
  ult: ["tongue", "puff"],
};
const MODES = {
  brow: "Eyebrow control",
  mouth: "Mouth control",
  wink: "Wink control",
  classic: "Classic (wink / mouth / tongue)",
};
const SIG = {
  brow: (b) =>
    M(
      b.browInnerUp || 0,
      ((b.browOuterUpLeft || 0) + (b.browOuterUpRight || 0)) / 2,
    ) / 0.5,
  mouth: F.mouth,
  wink: F.wink,
};
const BOTH = (b) =>
  M(0, Math.min(b.eyeBlinkLeft || 0, b.eyeBlinkRight || 0) - 0.2) / 0.5;
const MOVES = [
  { k: "atk", e: "👊", n: "Punch", d: "Raise eyebrows" },
  { k: "def", e: "🛡️", n: "Shield", d: "Pout (lips forward)" },
  { k: "ult", e: "🔥", n: "Fireball", d: "Open your mouth" },
];
const mkP = (i) => ({
  i,
  dir: i ? -1 : 1,
  x: i ? 900 : 380,
  hp: 100,
  sh: 100,
  ch: 0,
  cd: 0,
  rage: false,
  cb: 0,
  lh: 0,
  swing: -1,
  hit: true,
  lunge: 0,
  dx: 0,
  hurt: 0,
  knock: 0,
  ko: false,
  fall: 0,
  win: false,
  locked: false,
  block: false,
  mode: "brow",
  prevAtk: false,
  lastUp: -9,
  dbl: false,
  base: null,
  rw: 0,
  face: null,
  pos: null,
  eyeMax: [0, 0],
  closed: [false, false],
  lvl: { atk: 0, def: 0, ult: 0 },
  on: { atk: false, def: false, ult: false },
});
const init = () => ({
  phase: "menu",
  t: MATCH_T,
  ann: "",
  annK: 0,
  winner: -2,
  p: [mkP(0), mkP(1)],
  balls: [],
  sparks: [],
  fx: [],
  shake: 0,
  sens: 1,
  n: 0,
  snapReq: false,
  cropY: 360,
  round: 1,
  calOn: false,
  names: ["", ""],
});
const nm = (s, i) =>
  ((s.names && s.names[i]) || "").trim() || "Player " + (i + 1);
const view = (s) => ({
  phase: s.phase,
  t: Math.ceil(s.t),
  ann: s.ann,
  annK: s.annK,
  winner: s.winner,
  round: s.round,
  cal: s.calOn,
  p: s.p.map((p) => ({
    hp: Math.round(p.hp),
    on: { ...p.on },
    has: !!p.face,
    mode: p.mode,
    rw: p.rw,
    raw: p.raw || "",
    base: !!p.base,
    lv: [p.lvl.atk, p.lvl.def, p.lvl.ult].map((v) => v.toFixed(2)).join(" / "),
  })),
});

/* ---------- face tracking ---------- */
function track(r, vw, vh, y0, s) {
  const sc = W / vw;
  const faces = (r.faceLandmarks || [])
    .map((lms, k) => {
      const b = {};
      r.faceBlendshapes?.[k]?.categories.forEach(
        (c) => (b[c.categoryName] = c.score),
      );
      const P = (i) => ({
        x: (1 - lms[i].x) * W,
        y: (lms[i].y * vh - y0) * sc,
      });
      const nose = P(1),
        l = P(234),
        rr = P(454),
        top = P(10),
        size = Math.hypot(l.x - rr.x, l.y - rr.y);
      const eyes = [
        [159, 145],
        [386, 374],
      ].map(([a, c]) => {
        const A = P(a),
          B = P(c);
        return {
          x: (A.x + B.x) / 2,
          y: (A.y + B.y) / 2,
          o: Math.hypot(A.x - B.x, A.y - B.y) / size,
        };
      });
      return {
        b,
        nose,
        top,
        size,
        eyes,
        lip: Math.hypot(P(13).x - P(14).x, P(13).y - P(14).y) / size,
        roll: Math.atan2(rr.y - l.y, Math.abs(rr.x - l.x)),
        cx: nose.x,
        rawEyeY: ((lms[159].y + lms[386].y) / 2) * vh,
      };
    })
    .sort((a, b) => a.cx - b.cx);
  let a = [null, null];
  if (faces.length > 1) a = [faces[0], faces[1]];
  else if (faces.length === 1) a[faces[0].cx < W / 2 ? 0 : 1] = faces[0];
  s.p.forEach((p, i) => {
    const f = (p.face = a[i]);
    if (!f) {
      p.on = { atk: false, def: false, ult: false };
      p.closed = [false, false];
      p.dodge = false;
      return;
    }
    p.pos = f;
    if (s.calOn) {
      p.acc = p.acc || {};
      p.accN = (p.accN || 0) + 1;
      for (const k in f.b) p.acc[k] = (p.acc[k] || 0) + f.b[k];
    } else if (p.base)
      for (const k in f.b) f.b[k] = M(0, f.b[k] - (p.base[k] || 0));
    p.raw =
      "jaw " +
      (f.b.jawOpen || 0).toFixed(2) +
      " · tilt " +
      Math.round(Math.abs(f.roll) * 57.3) +
      "° · pout " +
      (f.b.mouthPucker || 0).toFixed(2) +
      " · lips " +
      f.lip.toFixed(2);
    p.lvl.atk = SIG.brow(f.b) * s.sens;
    p.lvl.def = F.tongue(f.b) * s.sens;
    p.lvl.ult = M(F.mouth(f.b), f.lip / 0.07) * s.sens;
    p.on.atk = p.lvl.atk >= HI;
    {
      const T = performance.now(),
        h = (p.h = p.h || { def: 0, ult: 0 }); // hold ~0.22s so gestures don't flicker
      if (p.lvl.def >= HI) h.def = T + 220;
      else if (p.lvl.ult >= HI) h.ult = T + 220;
      p.on.def = T < h.def;
      p.on.ult = T < h.ult && !p.on.def;
    }
    p.dodge = Math.abs(f.roll) > 0.32;
    f.eyes.forEach((e, j) => {
      p.eyeMax[j] = M(e.o, p.eyeMax[j] * 0.997);
      p.closed[j] = e.o < p.eyeMax[j] * 0.5;
    });
  });
  if (faces.length)
    s.cropY +=
      (faces.reduce((q, f) => q + f.rawEyeY, 0) / faces.length - s.cropY) *
      0.15;
}

/* ---------- drawing ---------- */
let BG;
function bg() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d"),
    hz = 530;
  let g = x.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, "#060b24");
  g.addColorStop(1, "#0b1a45");
  x.fillStyle = g;
  x.fillRect(0, 0, W, hz);
  g = x.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, "#0a1636");
  g.addColorStop(1, "#050c24");
  x.fillStyle = g;
  x.fillRect(0, hz, W, H - hz);
  x.strokeStyle = "rgba(255,79,163,.6)";
  x.lineWidth = 2;
  for (let i = 1; i <= 8; i++) {
    const y = hz + Math.pow(i / 8, 2) * (H - hz);
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(W, y);
    x.stroke();
  }
  for (let i = -14; i <= 14; i++) {
    x.beginPath();
    x.moveTo(640 + i * 34, hz);
    x.lineTo(640 + i * 200, H);
    x.stroke();
  }
  x.lineWidth = 3;
  x.strokeStyle = "rgba(255,79,163,.9)";
  x.beginPath();
  x.moveTo(0, hz);
  x.lineTo(W, hz);
  x.stroke();
  BG = c;
}
const ease = (t) => 1 - (1 - t) * (1 - t);
function fighter(x, p, t) {
  const col = COL[p.i],
    K = (c) => (p.hurt > 0.5 ? "#fff" : c),
    Lv = p.face ? p.lvl : { atk: 0, def: 0, ult: 0 };
  const win = p.win ? -Math.abs(Math.sin(t * 6)) * 45 : 0;
  x.save();
  x.translate(p.x + p.dx, GY + win);
  x.scale(p.dir, 1);
  x.fillStyle = "rgba(0,0,0,.45)";
  x.beginPath();
  x.ellipse(0, -win, 82, 14, 0, 0, 7);
  x.fill();
  if (p.ko) {
    const f = ease(p.fall);
    x.translate(-f * 50, 0);
    x.rotate(-f * 1.45);
  }
  const bob = p.ko ? 0 : Math.sin(t * 4 + p.i) * 3;
  x.translate(0, bob);
  x.lineJoin = "round";
  x.lineCap = "round";
  x.shadowColor = col;
  x.shadowBlur = 30;
  // legs
  x.strokeStyle = K(col);
  x.lineWidth = 26;
  [
    [-22, 0],
    [22, p.lunge * 40],
  ].forEach(([hx, off]) => {
    x.beginPath();
    x.moveTo(hx, -70);
    x.lineTo(hx + off, -16);
    x.stroke();
  });
  // body
  x.fillStyle = K(col);
  x.beginPath();
  x.roundRect(-44, -178, 88, 126, 40);
  x.fill();
  // arm (swings on attack)
  const a0 = -2.2,
    a1 = 0.55,
    a = p.win
      ? -0.9
      : p.swing >= 0
        ? a0 + (a1 - a0) * ease(Math.min(1, p.swing))
        : 0.9 + Math.sin(t * 3 + p.i) * 0.05;
  const sx0 = 34,
    sy0 = -150,
    hx = sx0 + Math.cos(a) * 82,
    hy = sy0 + Math.sin(a) * 82;
  if (p.swing >= 0.1 && p.swing < 0.95) {
    x.shadowBlur = 0;
    [0.55, 0.3, 0.15].forEach((al, k) => {
      x.strokeStyle = `rgba(255,255,255,${al})`;
      x.lineWidth = 24 - k * 7;
      x.beginPath();
      x.arc(sx0, sy0, 125 + k * 10, a0, a - 0.02 * k);
      x.stroke();
    });
    x.shadowBlur = 30;
  }
  x.strokeStyle = K(col);
  x.lineWidth = 26;
  x.beginPath();
  x.moveTo(sx0, sy0);
  x.lineTo(hx, hy);
  x.stroke();
  // head
  x.shadowBlur = 0;
  const cy = -236,
    up = Math.min(1, Lv.atk),
    mo = Math.min(1, Lv.ult),
    tg = Math.min(1, Lv.def),
    ink = "#1a1020";
  x.fillStyle = K("#f7dcb4");
  x.beginPath();
  x.arc(0, cy, 64, 0, 7);
  x.fill();
  [-1, 1].forEach((j, k) => {
    const ex = j * 26,
      ey = cy - 5;
    x.strokeStyle = ink;
    x.fillStyle = ink;
    if (p.ko) {
      x.lineWidth = 5;
      x.beginPath();
      x.moveTo(ex - 9, ey - 9);
      x.lineTo(ex + 9, ey + 9);
      x.moveTo(ex + 9, ey - 9);
      x.lineTo(ex - 9, ey + 9);
      x.stroke();
    } else if (p.closed[k] || p.hurt > 0.3) {
      x.lineWidth = 5;
      x.beginPath();
      x.moveTo(ex - 12, ey);
      x.lineTo(ex + 12, ey);
      x.stroke();
    } else {
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(ex, ey, 16, 0, 7);
      x.fill();
      x.fillStyle = ink;
      x.beginPath();
      x.arc(ex + (p.swing >= 0 ? 4 : 0), ey + 1, 7, 0, 7);
      x.fill();
    }
    const by = cy - 40 - (p.ko ? 0 : up * 16),
      tl = p.swing >= 0 ? 10 : 0;
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(ex + j * 21, by - tl * 0.4);
    x.lineTo(ex - j * 21, by + tl);
    x.stroke();
  });
  const my = cy + 38;
  if (tg > 0.35 && !p.ko) {
    x.fillStyle = "#ff6f9a";
    x.beginPath();
    x.roundRect(-10, my - 2, 20, 10 + tg * 18, 9);
    x.fill();
  }
  if (mo > 0.2 && !p.ko) {
    x.fillStyle = "#3a1620";
    x.beginPath();
    x.ellipse(0, my + 2 + mo * 7, 11 + mo * 3, 4 + mo * 14, 0, 0, 7);
    x.fill();
  } else {
    x.lineWidth = 5;
    x.strokeStyle = ink;
    x.beginPath();
    x.moveTo(-14, my);
    x.lineTo(14, my);
    x.stroke();
  }
  // shield bubble
  if (p.block) {
    x.fillStyle = "rgba(95,233,255,.2)";
    x.strokeStyle = "#e8fdff";
    x.lineWidth = 6;
    x.shadowColor = "#5fe9ff";
    x.shadowBlur = 30;
    x.beginPath();
    x.arc(60, -125, 105, 0, 7);
    x.fill();
    x.stroke();
  }
  x.restore();
}
function cams(x, s, v, cam, vw, vh) {
  const PW = 190,
    PH = 214,
    PY = H - PH - 22;
  [0, 1].forEach((i) => {
    const p = s.p[i],
      px = i ? W - PW - 22 : 22,
      Lv = p.face ? p.lvl : { atk: 0, def: 0, ult: 0 };
    x.save();
    x.beginPath();
    x.roundRect(px, PY, PW, PH, 14);
    x.clip();
    if (cam) {
      x.translate(px + PW, PY);
      x.scale(-1, 1);
      x.drawImage(v, i ? 0 : vw / 2, 0, vw / 2, vh, 0, 0, PW, PH);
    } else {
      x.fillStyle = "#0b0a2a";
      x.fillRect(px, PY, PW, PH);
    }
    x.restore();
    x.save();
    x.fillStyle = "rgba(5,3,24,.82)";
    x.beginPath();
    x.roundRect(px, PY, PW, 48, [14, 14, 0, 0]);
    x.fill();
    x.textAlign = "left";
    x.font = '700 15px "Chakra Petch",monospace';
    x.fillStyle = COL[i];
    x.fillText(
      nm(s, i).toUpperCase() +
        (p.bot ? " · BOT" : p.face ? "" : " · NO FACE"),
      px + 10,
      PY + 18,
    );
    x.font = "12px monospace";
    x.fillStyle = "#fff";
    x.fillText(
      "punch " + Lv.atk.toFixed(2) + "  shield " + Lv.def.toFixed(2),
      px + 10,
      PY + 33,
    );
    x.fillText("fireball " + Lv.ult.toFixed(2), px + 10, PY + 45);
    x.restore();
    x.save();
    x.strokeStyle = COL[i];
    x.lineWidth = 4;
    x.shadowColor = COL[i];
    x.shadowBlur = 16;
    x.beginPath();
    x.roundRect(px, PY, PW, PH, 14);
    x.stroke();
    x.restore();
  });
}
function drawHud(x, s, t) {
  const BW = 540,
    BX = 46,
    BY = 38,
    BH = 34;
  [0, 1].forEach((i) => {
    const p = s.p[i],
      l = i === 0,
      x0 = l ? BX : W - BX - BW,
      ax = l ? x0 : x0 + BW,
      al = l ? "left" : "right";
    x.save();
    x.textAlign = al;
    x.font = "36px Anton,Impact,sans-serif";
    x.lineWidth = 7;
    x.lineJoin = "round";
    x.strokeStyle = "#10081c";
    x.fillStyle = "#fff";
    x.shadowColor = COL[i];
    x.shadowBlur = 14;
    x.strokeText(nm(s, i), ax, 31);
    x.fillText(nm(s, i), ax, 31);
    x.restore();
    x.save();
    x.fillStyle = "rgba(5,3,24,.85)";
    x.fillRect(x0, BY, BW, BH);
    const fw = (BW * Math.max(0, p.hp)) / 100;
    x.shadowColor = COL[i];
    x.shadowBlur = 22;
    x.fillStyle = COL[i];
    x.fillRect(l ? x0 : x0 + BW - fw, BY, fw, BH);
    x.shadowBlur = 14;
    x.strokeStyle = "#fff";
    x.lineWidth = 4;
    x.strokeRect(x0, BY, BW, BH);
    x.restore();
    const sw = (BW * Math.max(0, p.sh)) / 100;
    x.fillStyle = "rgba(5,3,24,.7)";
    x.fillRect(x0, BY + BH + 7, BW, 5);
    x.fillStyle = "#bffcff";
    x.fillRect(l ? x0 : x0 + BW - sw, BY + BH + 7, sw, 5);
    const rd = p.ch >= 100;
    x.save();
    x.textAlign = al;
    x.font = "26px Anton,Impact,sans-serif";
    x.fillStyle = "#ffe45e";
    x.globalAlpha = rd ? 0.75 + 0.25 * Math.sin(t * 10) : 0.45;
    x.shadowColor = "#ffb800";
    x.shadowBlur = rd ? 12 : 0;
    x.fillText(
      rd ? "SPECIAL READY" : "SPECIAL " + Math.floor(p.ch) + "%",
      ax,
      BY + BH + 40,
    );
    x.restore();
    for (let j = 0; j < 2; j++) {
      const dx = l ? 550 - j * 26 : 730 + j * 26;
      x.beginPath();
      x.arc(dx, 104, 9, 0, 7);
      x.fillStyle = p.rw > j ? COL[i] : "#1e1a36";
      x.fill();
      x.strokeStyle = "#ffffff30";
      x.lineWidth = 2;
      x.stroke();
    }
  });
  x.save();
  x.textAlign = "center";
  x.font = "68px Anton,Impact,sans-serif";
  x.fillStyle = "#fff6b0";
  x.shadowColor = "#ffe45e";
  x.shadowBlur = 26;
  x.fillText("VS", 640, 76);
  x.shadowBlur = 0;
  x.font = '500 26px "Chakra Petch",system-ui,sans-serif';
  x.fillStyle = "#fff";
  x.fillText("Round " + s.round, 640, 108);
  x.font = "30px Anton,Impact,sans-serif";
  x.fillStyle = "#ffffffb0";
  x.fillText(Math.ceil(s.t), 640, 142);
  x.restore();
}

export default function App() {
  const c0 = useRef(),
    c1 = useRef(),
    vid = useRef(),
    cv = useRef(),
    lm = useRef(),
    G = useRef(init());
  window.__fw = G;
  const [ui, setUi] = useState(view(G.current));
  const [sv, setSv] = useState(1);
  const [msg, setMsg] = useState("");
  const [bot, setBot] = useState(false),
    [snd, setSnd] = useState(true);
  const setBotMode = (v) => {
    setBot(v);
    G.current.bot = v;
  };
  const setSound = (v) => {
    setSnd(v);
    SFX.mute = !v;
    if (v) SFX.count(); // little preview beep when sound is switched on
  };
  const [names, setNames] = useState(["", ""]);
  const setName = (i, v) => {
    const n = [...names];
    n[i] = v.slice(0, 12);
    setNames(n);
    G.current.names = n;
  };
  const [card, setCard] = useState({});
  const sync = () => setUi(view(G.current));

  const startRound = () => {
    const s = G.current;
    s.p.forEach((p, i) =>
      Object.assign(p, {
        x: i ? 900 : 380,
        hp: 100,
        sh: 100,
        ch: 0,
        cd: 0,
        swing: -1,
        lunge: 0,
        dx: 0,
        hurt: 0,
        knock: 0,
        ko: false,
        fall: 0,
        win: false,
        locked: false,
      }),
    );
    s.balls = [];
    s.fx = [];
    s.winner = -2;
    setCard({});
    s.phase = "intro";
    s.ann = "";
    sync();
    ["3", "2", "1", "FIGHT!"].forEach((n, k) =>
      setTimeout(
        () => {
          if (s.phase !== "intro") return;
          s.ann = n;
          s.annK++;
          n === "FIGHT!" ? SFX.go() : SFX.count();
          if (n === "FIGHT!") {
            s.phase = "fight";
            s.t0 = performance.now();
            s.t = MATCH_T;
          }
          sync();
        },
        300 + k * 700,
      ),
    );
  };
  const startMatch = () => {
    const s = G.current;
    s.p.forEach((p) => (p.rw = 0));
    s.round = 1;
    startRound();
  };
  const calibrate = () => {
    const s = G.current;
    s.p.forEach((p) => {
      p.acc = {};
      p.accN = 0;
      p.base = null;
    });
    s.calOn = true;
    sync();
    setTimeout(() => {
      s.calOn = false;
      s.p.forEach((p) => {
        if (p.accN > 5) {
          p.base = {};
          for (const k in p.acc) p.base[k] = p.acc[k] / p.accN;
        }
      });
      sync();
    }, 1800);
  };
  const endMatch = () => {
    const s = G.current,
      [a, b] = s.p,
      w = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1;
    if (w >= 0) s.p[w].rw++;
    s.p.forEach((p, i) => {
      p.win = w === i;
      p.ko = w >= 0 && w !== i;
    });
    SFX.ko();
    s.ann = a.hp <= 0 || b.hp <= 0 ? "K.O.!" : "TIME!";
    s.annK++;
    s.phase = "ko";
    sync();
    const over = s.p.some((p) => p.rw >= 2) || s.round >= 3;
    setTimeout(() => {
      if (!over) {
        s.round++;
        startRound();
        return;
      }
      s.winner = a.rw > b.rw ? 0 : b.rw > a.rw ? 1 : -1;
      SFX.win();
      s.p.forEach((p, i) => {
        p.win = s.winner === i;
        p.ko = s.winner >= 0 && s.winner !== i;
      });
      s.phase = "result";
      s.ann = "";
      s.snapReq = true;
      sync();
    }, 2200);
  };
  const makeCard = async (c) => {
    const s = G.current,
      o = document.createElement("canvas");
    o.width = W;
    o.height = H;
    const x = o.getContext("2d");
    x.drawImage(c, 0, 0);
    const g = x.createLinearGradient(0, H - 110, 0, H);
    g.addColorStop(0, "rgba(11,10,26,0)");
    g.addColorStop(1, "rgba(11,10,26,.9)");
    x.fillStyle = g;
    x.fillRect(0, H - 110, W, 110);
    x.textAlign = "center";
    x.font = "60px Anton,Impact,sans-serif";
    x.fillStyle = "#ffe45e";
    x.fillText(
      s.winner < 0 ? "DRAW" : `${nm(s, s.winner).toUpperCase()} WINS!`,
      W / 2,
      H - 62,
    );
    x.font = "30px Anton,Impact,sans-serif";
    x.fillStyle = "#fff";
    x.fillText("FACE WARS", W / 2, H - 24);
    const blob = await new Promise((r) => o.toBlob(r, "image/jpeg", 0.88)),
      local = URL.createObjectURL(blob);
    const qr = (u) =>
      QRCode.toDataURL(u, {
        margin: 1,
        width: 280,
        color: { dark: "#0b0a1a", light: "#ffffff" },
      });
    // 1) own server (node server.js) if running
    try {
      const r = await fetch("/api/card", { method: "POST", body: blob });
      if (!r.ok) throw 0;
      const { id } = await r.json();
      let base = location.origin;
      if (["localhost", "127.0.0.1"].includes(location.hostname)) {
        const i = await (await fetch("/api/info")).json();
        const ip =
          i.ips.find((a) =>
            /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a),
          ) || i.ips[0];
        if (ip) base = `http://${ip}:${i.port}`;
      }
      const url = `${base}/card/${id}`;
      return setCard({ local, url, qr: await qr(url) });
    } catch {}
    // 2) no server: upload to a free temporary host, works on any Wi-Fi/mobile data
    try {
      const fd = new FormData();
      fd.append(
        "file",
        new File([blob], "face-wars.jpg", { type: "image/jpeg" }),
      );
      const r = await fetch("https://tmpfiles.org/api/v1/upload", {
        method: "POST",
        body: fd,
      });
      if (!r.ok) throw 0;
      const j = await r.json();
      const u = j?.data?.url;
      if (!u) throw 0;
      const url = u
        .replace(/^http:/, "https:")
        .replace("tmpfiles.org/", "tmpfiles.org/dl/");
      return setCard({ local, url, qr: await qr(url) });
    } catch {
      setCard({
        local,
        err: "QR upload failed (check internet). You can still use Save card.",
      });
    }
  };
  const enter = async () => {
    const s = G.current;
    s.phase = "loading";
    setMsg("");
    sync();
    const T = (p, ms, what) =>
      Promise.race([
        p,
        new Promise((_, j) =>
          setTimeout(() => j(new Error(what + " timed out")), ms),
        ),
      ]);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        throw new Error(
          "Camera needs http://localhost:3000 or https (not file:// or a plain http IP)",
        );
      // 1) camera first, so the permission prompt shows immediately
      if (!vid.current.srcObject) {
        vid.current.srcObject = await T(
          navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user",
            },
            audio: false,
          }),
          20000,
          "Camera permission",
        );
      }
      await vid.current.play();
      // 2) model, GPU first then CPU fallback
      if (!lm.current) {
        const fs = await T(
          FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
          ),
          30000,
          "Loading vision files",
        );
        const mk = (d) =>
          FaceLandmarker.createFromOptions(fs, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              delegate: d,
            },
            runningMode: "VIDEO",
            numFaces: 2,
            outputFaceBlendshapes: true,
          });
        try {
          lm.current = await T(mk("GPU"), 30000, "Loading face model (GPU)");
        } catch (g) {
          console.warn("GPU failed, using CPU", g);
          lm.current = await T(mk("CPU"), 45000, "Loading face model (CPU)");
        }
      }
      SFX.music(true);
      s.phase = "setup";
      sync();
    } catch (e) {
      console.error(e);
      const v = vid.current;
      if (v && v.srcObject) {
        v.srcObject.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }
      lm.current = null;
      s.phase = "menu";
      const n = e && e.name;
      let why = e.message || String(e);
      if (n === "NotAllowedError")
        why =
          "Camera permission blocked. Click the camera icon in the address bar, allow it, then reload.";
      else if (n === "NotFoundError") why = "No camera found.";
      else if (n === "NotReadableError")
        why =
          "Camera is being used by another app (Zoom/Meet/other tab). Close it and retry.";
      setMsg("Could not start: " + why);
      sync();
    }
  };

  useEffect(() => {
    let raf;
    bg();
    const spark = (s, x, y, c, n) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28,
          v = 150 + Math.random() * 350;
        s.sparks.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 120,
          life: 0.6,
          c,
        });
      }
    };
    const hurt = (s, t, o, d, c) => {
      if (o.dodge && s.phase === "fight") {
        s.fx.push({
          x: o.x + o.dx,
          y: GY - 340,
          txt: "DODGE",
          c: "#8dffb0",
          life: 1,
        });
        SFX.swing();
        return;
      }
      const A = s.p[1 - o.i];
      if (A.hp < 30 && A.hp > 0 && s.phase === "fight") {
        d = Math.round(d * 1.3);
        if (!A.rage) {
          A.rage = true;
          s.fx.push({
            x: A.x + A.dx,
            y: GY - 420,
            txt: "RAGE MODE!",
            c: "#ff6b3d",
            life: 1.4,
          });
          SFX.fire();
        }
      }
      const bx = o.x + o.dx;
      if (o.block) {
        SFX.block();
        o.sh = M(0, o.sh - (d > 10 ? 45 : 15));
        spark(s, bx + o.dir * 40, GY - 125, "#3df0e0", 10);
        s.fx.push({ x: bx, y: GY - 340, txt: "BLOCK", c: "#3df0e0", life: 1 });
        if (performance.now() - (o.bt || 0) < 280) {
          // perfect block: refund shield + counter hit
          const a = s.p[1 - o.i];
          o.sh = Math.min(100, o.sh + (d > 10 ? 45 : 15));
          SFX.hit(true);
          if (s.phase === "fight") {
            a.hp = M(0, a.hp - 10);
            a.hurt = 1;
            a.knock = 1;
            s.shake = 0.8;
          }
          spark(s, a.x + a.dx, GY - 140, "#ffe45e", 14);
          s.fx.push({
            x: bx,
            y: GY - 420,
            txt: "PERFECT!",
            c: "#ffe45e",
            life: 1.2,
          });
        }
      } else {
        SFX.hit(d > 10);
        if (s.phase === "fight") {
          o.hp = M(0, o.hp - d);
          const a = s.p[1 - o.i],
            T = performance.now();
          a.cb = T - (a.lh || 0) < 1600 ? (a.cb || 0) + 1 : 1;
          a.lh = T;
          if (a.cb >= 3) {
            const bn = Math.min(a.cb - 2, 3) * 3;
            o.hp = M(0, o.hp - bn);
            s.fx.push({
              x: bx,
              y: GY - 420,
              txt: "COMBO x" + a.cb,
              c: "#ff4fa3",
              life: 1.2,
            });
          }
        }
        o.hurt = 1;
        o.knock = 1;
        s.shake = d > 10 ? 1 : 0.45;
        spark(s, bx, GY - 140, c, 16);
        s.fx.push({
          x: bx,
          y: GY - 340,
          txt: "-" + d,
          c: d > 10 ? "#ffcf33" : "#fff",
          life: 1,
        });
      }
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = G.current,
        v = vid.current,
        c = cv.current;
      if (!c) return;
      const x = c.getContext("2d"),
        now = performance.now(),
        t = now / 1000,
        dt =
          Math.min(0.05, (now - (s.last || now)) / 1000) *
          (s.phase === "ko" ? 0.4 : 1);
      s.last = now;
      const cam =
        !!lm.current &&
        v.readyState >= 2 &&
        s.phase !== "menu" &&
        s.phase !== "loading";
      const vw = v.videoWidth || 1280,
        vh = v.videoHeight || 720,
        sc = W / vw,
        srcH = BAND / sc;
      const y0 = Math.min(
        Math.max(0, s.cropY - srcH / 2),
        Math.max(0, vh - srcH),
      );
      if (cam) track(lm.current.detectForVideo(v, now), vw, vh, y0, s);
      else
        s.p.forEach((p) => {
          p.face = null;
          p.on = { atk: false, def: false, ult: false };
          p.closed = [false, false];
        });
      if (s.bot) {
        // solo mode: player 2 is a bot
        const [a, b] = s.p;
        if (!a.face && b.face) {
          ["face", "pos", "closed", "eyeMax", "raw", "dodge"].forEach(
            (k) => (a[k] = b[k]),
          );
          a.on = { ...b.on };
          a.lvl = { ...b.lvl };
        }
        b.face = null;
        b.pos = null;
        b.bot = true;
        b.dodge = false;
        const B = (s.botS = s.botS || { u: 0, k: "" });
        if (s.phase === "fight" || s.phase === "lobby") {
          if (now > B.u) {
            const r = Math.random();
            B.k =
              a.swing >= 0
                ? r < 0.5
                  ? "def"
                  : "atk"
                : b.ch >= 100 && r < 0.7
                  ? "ult"
                  : r < 0.55
                    ? "atk"
                    : r < 0.7
                      ? "def"
                      : "";
            B.u = now + 300 + Math.random() * 500;
          }
        } else B.k = "";
        b.on = { atk: B.k === "atk", def: B.k === "def", ult: B.k === "ult" };
      } else s.p[1].bot = false;
      if (cam && s.phase === "setup")
        [c0, c1].forEach((r, i) => {
          const cc = r.current;
          if (!cc) return;
          const y = cc.getContext("2d");
          y.save();
          y.translate(cc.width, 0);
          y.scale(-1, 1);
          y.drawImage(
            v,
            i ? 0 : vw / 2,
            0,
            vw / 2,
            vh,
            0,
            0,
            cc.width,
            cc.height,
          );
          y.restore();
        });

      const live = s.phase === "fight" || s.phase === "lobby";
      if (live) {
        if (s.phase === "fight") {
          s.t = Math.max(0, MATCH_T - (now - s.t0) / 1000);
        }
        s.p.forEach((p, i) => {
          const o = s.p[1 - i];
          p.cd = M(0, p.cd - dt);
          const wb = p.block;
          p.block =
            (!!p.face || p.bot) &&
            p.on.def &&
            p.sh > 0 &&
            !p.locked &&
            p.swing < 0;
          if (p.block && !wb) p.bt = performance.now();
          if (p.block) {
            p.sh -= 38 * dt;
            if (p.sh <= 0) {
              p.sh = 0;
              p.locked = true;
            }
          } else {
            p.sh = Math.min(100, p.sh + 22 * dt);
            if (p.locked && p.sh > 30) p.locked = false;
          }
          p.ch = Math.min(
            100,
            p.ch +
              (s.phase === "lobby" ? 30 : 14) *
                (p.hp < 30 && s.phase === "fight" ? 1.8 : 1) *
                dt,
          );
          if ((p.face || p.bot) && p.swing < 0) {
            if (p.on.ult && p.ch >= 100) {
              p.ch = 0;
              p.swing = 0;
              p.hit = true;
              SFX.fire();
              s.balls.push({
                x: p.x + p.dir * 170,
                y: GY - 150,
                dir: p.dir,
                from: i,
              });
            } else if (p.on.atk && p.cd <= 0 && !p.block) {
              p.cd = 0.5;
              p.swing = 0;
              p.hit = false;
              SFX.swing();
              spark(s, p.x, GY, "#d9b38c", 6);
            }
          }
          if (p.swing >= 0) {
            p.swing += dt / 0.34;
            if (!p.hit && p.swing >= 0.45) {
              p.hit = true;
              hurt(s, t, o, 9, "#fff");
            }
            if (p.swing >= 1) p.swing = -1;
          }
        });
        s.balls = s.balls.filter((b) => {
          const o = s.p[1 - b.from];
          b.x += b.dir * 880 * dt;
          if (b.dir > 0 ? b.x < o.x + o.dx - 40 : b.x > o.x + o.dx + 40)
            return true;
          hurt(s, t, o, 25, "#ffcf33");
          return false;
        });
        if (s.phase === "fight" && (s.p.some((p) => p.hp <= 0) || s.t <= 0))
          endMatch();
        if (s.phase === "lobby") s.p.forEach((p) => (p.hp = 100));
      }
      s.p.forEach((p) => {
        p.hurt = M(0, p.hurt - dt * 4);
        p.knock *= Math.pow(0.002, dt);
        if (s.phase !== "fight" && s.phase !== "lobby" && p.swing >= 0) {
          p.swing += dt / 0.34;
          if (p.swing >= 1) p.swing = -1;
        }
        p.lunge = p.swing >= 0 ? Math.sin(Math.min(1, p.swing) * Math.PI) : 0;
        p.dx = p.dir * p.lunge * 135 - p.dir * p.knock * 45;
        if (p.ko) p.fall = Math.min(1, p.fall + dt * 1.6);
      });
      s.shake = M(0, s.shake - dt * 2.5);
      s.fx = s.fx.filter((f) => (f.life -= dt * 1.3) > 0);
      s.sparks = s.sparks.filter((q) => {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 900 * dt;
        return (q.life -= dt) > 0;
      });

      x.save();
      if (s.shake > 0)
        x.translate(
          (Math.random() - 0.5) * 26 * s.shake,
          (Math.random() - 0.5) * 26 * s.shake,
        );
      x.filter = `hue-rotate(${[0, 140, 250][((s.round || 1) - 1) % 3]}deg)`;
      x.drawImage(BG, 0, 0);
      x.filter = "none";
      s.p.forEach((p) => fighter(x, p, t));
      s.balls.forEach((b) => {
        const g = x.createRadialGradient(b.x, b.y, 5, b.x, b.y, 70);
        g.addColorStop(0, "#fff");
        g.addColorStop(0.3, "#ffcf33");
        g.addColorStop(0.7, "rgba(255,90,40,.6)");
        g.addColorStop(1, "rgba(255,60,40,0)");
        x.fillStyle = g;
        x.beginPath();
        x.arc(b.x, b.y, 70, 0, 7);
        x.fill();
      });
      s.sparks.forEach((q) => {
        x.globalAlpha = Math.min(1, q.life * 2);
        x.fillStyle = q.c;
        x.fillRect(q.x, q.y, 7, 7);
      });
      x.globalAlpha = 1;
      s.fx.forEach((f) => {
        x.globalAlpha = Math.min(1, f.life * 1.5);
        x.fillStyle = f.c;
        x.strokeStyle = "#10081c";
        x.lineWidth = 8;
        x.font = "60px Anton,Impact,sans-serif";
        x.textAlign = "center";
        const y = f.y - (1 - f.life) * 70;
        x.strokeText(f.txt, f.x, y);
        x.fillText(f.txt, f.x, y);
        x.globalAlpha = 1;
      });
      if (s.phase === "result" && s.winner >= 0) {
        const w = s.p[s.winner];
        x.font = "80px serif";
        x.textAlign = "center";
        x.fillText("👑", w.x + w.dx, GY - 350 + Math.sin(t * 4) * 8);
      }
      const show = ["lobby", "intro", "fight", "ko", "result"].includes(
        s.phase,
      );
      if (show) cams(x, s, v, cam, vw, vh);
      if (["fight", "ko", "intro", "result"].includes(s.phase))
        drawHud(x, s, t);
      x.restore();
      if (s.snapReq) {
        s.snapReq = false;
        makeCard(c);
      }
      if (++s.n % 3 === 0) sync();
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const faces = ui.p.filter((p) => p.has).length;
  const resTxt =
    ui.winner < 0 ? "Draw!" : `${nm(G.current, ui.winner)} wins!`;
  const n0 = nm({ names }, 0),
    n1 = nm({ names }, 1);
  const modeTxt = bot ? "vs Bot" : "2 Players";
  return (
    <main>
      <div className="stage">
        <video ref={vid} playsInline muted />
        <canvas ref={cv} width={W} height={H} />

        {ui.ann && (
          <div
            key={ui.annK}
            className={
              "ann " +
              (ui.ann === "FIGHT!" ? "fight" : /^\d$/.test(ui.ann) ? "num" : "")
            }
          >
            {ui.ann}
          </div>
        )}

        {(ui.phase === "menu" || ui.phase === "loading") && (
          <section className="screen menu light">
            <header className="topbar">
              <div className="brand">
                <span className="logo">😝</span>
                <b>
                  Face <em>Wars</em>
                </b>
              </div>
              <nav>
                <a href="rules.html" target="_blank" rel="noopener">
                  How to play
                </a>
              </nav>
              <button
                className="pill"
                onClick={enter}
                disabled={ui.phase === "loading"}
              >
                {ui.phase === "loading" ? "Loading…" : "Let’s play"}{" "}
                <span className="ar">↗</span>
              </button>
            </header>
            <div className="hero">
              <div className="copy">
                <small className="eyebrow">
                  TWO PLAYERS · ONE WEBCAM · NO HANDS
                </small>
                <h1>
                  Face Wars<em>Duel</em>
                </h1>
                <h3>Fight with your face. Win with style.</h3>
                <p className="tag">
                  Raise your eyebrows, pout, open wide or tilt your head. Win
                  two out of three rounds before the clock runs out.
                </p>
                <div className="btns">
                  <button
                    className="cta"
                    onClick={enter}
                    disabled={ui.phase === "loading"}
                  >
                    {ui.phase === "loading" ? (
                      "Loading camera…"
                    ) : (
                      <>
                        Start battle <span className="ar">↗</span>
                      </>
                    )}
                  </button>
                  <a
                    className="ghost"
                    href="rules.html"
                    target="_blank"
                    rel="noopener"
                  >
                    How to play <span className="ar r">→</span>
                  </a>
                </div>
                <div className="stats">
                  <span>👊 4 moves</span>
                  <span>⏱ 30 seconds</span>
                  <span>🏆 Best of 3</span>
                </div>
                {msg && <p className="err">{msg}</p>}
              </div>
              <div className="art">
                <i className="blob" />
                {[
                  ["👊", "Punch", "Eyebrows up"],
                  ["🛡️", "Shield", "Pout"],
                  ["🔥", "Fireball", "Mouth open"],
                  ["💨", "Dodge", "Tilt head"],
                ].map(([e, n, h], k) => (
                  <div
                    className="mcard"
                    key={n}
                    style={{ "--d": k * 0.6 + "s" }}
                  >
                    <span>{e}</span>
                    <b>{n}</b>
                    <small>{h}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {ui.phase === "setup" && (
          <section className="screen setup light">
            <header className="topbar">
              <div className="brand">
                <span className="logo">😝</span>
                <b>
                  Face <em>Wars</em>
                </b>
              </div>
              <span className="steptitle">Camera &amp; calibration</span>
              <a className="pill" href="rules.html" target="_blank" rel="noopener">
                How to play <span className="ar r">→</span>
              </a>
            </header>
            <p className="tag">
              Type your names, then stand side by side: first player on the
              LEFT, second on the RIGHT.
            </p>
            <div className="pick">
              {[0, 1].map((i) => (
                <div key={i} className="pk">
                  <canvas
                    ref={i ? c1 : c0}
                    width={360}
                    height={405}
                    className={"cam p" + i}
                  />
                  <input
                    className={"nm p" + i}
                    value={names[i]}
                    onChange={(e) => setName(i, e.target.value)}
                    placeholder={"Player " + (i + 1)}
                    maxLength={12}
                    aria-label={"Name for player " + (i + 1)}
                  />
                  <div className="badges">
                    <span className={ui.p[i].has ? "b ok" : "b bad"}>
                      {ui.p[i].has ? "● Face found" : "● No face"}
                    </span>
                    {ui.p[i].base && <span className="b ok">✔ Calibrated</span>}
                  </div>
                  <div className="chips">
                    {[
                      ["atk", "👊"],
                      ["def", "🛡️"],
                      ["ult", "🔥"],
                    ].map(([k, e]) => (
                      <span key={k} className={ui.p[i].on[k] ? "on" : ""}>
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="keys">
              Eyebrows up: punch <i>|</i> Pout: shield <i>|</i> Mouth open:
              fireball <i>|</i> Tilt head: dodge
            </p>
            <div className="row">
              <button className="ghost" onClick={calibrate} disabled={ui.cal}>
                {ui.cal ? "Hold still…" : "Calibrate (relax your face)"}
              </button>
              <div className="seg" role="group" aria-label="Mode">
                <em>MODE</em>
                <button
                  className={!bot ? "on" : ""}
                  aria-pressed={!bot}
                  onClick={() => setBotMode(false)}
                >
                  2 Players
                </button>
                <button
                  className={bot ? "on" : ""}
                  aria-pressed={bot}
                  onClick={() => setBotMode(true)}
                >
                  vs Bot
                </button>
              </div>
              <div className="seg" role="group" aria-label="Sound">
                <em>SOUND</em>
                <button
                  className={snd ? "on" : ""}
                  aria-pressed={snd}
                  onClick={() => setSound(true)}
                >
                  On
                </button>
                <button
                  className={!snd ? "on" : ""}
                  aria-pressed={!snd}
                  onClick={() => setSound(false)}
                >
                  Off
                </button>
              </div>
              <button
                className="cta"
                onClick={() => {
                  G.current.phase = "lobby";
                  sync();
                }}
              >
                Enter arena <span className="ar">↗</span>
              </button>
            </div>
          </section>
        )}

        {ui.phase === "lobby" && (
          <>
            <div className="legend">
              {MOVES.map((m) => (
                <div className="mv" key={m.k}>
                  <span className="em">{m.e}</span>
                  <div>
                    <b>{m.n}</b>
                    <small>{m.d}</small>
                  </div>
                  <i className={ui.p[0].on[m.k] ? "a on" : "a"}>P1</i>
                  <i className={ui.p[1].on[m.k] ? "b on" : "b"}>P2</i>
                </div>
              ))}
            </div>
            <div className="lbar">
              <span className={faces === 2 || bot ? "ok" : ""}>
                {bot
                  ? n0 + " vs " + n1 + " (BOT). Practice your moves!"
                  : n0 + " vs " + n1 + " · " + faces + " of 2 faces found. Practice your moves!"}
              </span>
              <label>
                Sensitivity
                <input
                  type="range"
                  min=".6"
                  max="1.6"
                  step=".05"
                  value={sv}
                  onChange={(e) => {
                    setSv(+e.target.value);
                    G.current.sens = +e.target.value;
                  }}
                />
              </label>
            </div>
            <button className="cta go" onClick={startMatch}>
              Start battle
            </button>
          </>
        )}

        {ui.phase === "result" && (
          <section className="res">
            <div className="rc">
              <h2>{resTxt}</h2>
              <div className="sc">
                <b style={{ color: COL[0] }}>{ui.p[0].hp}</b>
                <span>HP</span>
                <b style={{ color: COL[1] }}>{ui.p[1].hp}</b>
              </div>
              {card.qr ? (
                <>
                  <img
                    className="qr"
                    src={card.qr}
                    alt="QR code to download your photo"
                  />
                  <p>
                    Scan with your phone camera to get your battle photo. Phone
                    must be on the same Wi-Fi.
                  </p>
                </>
              ) : (
                <p>{card.err || "Making your photo…"}</p>
              )}
              <div className="row">
                {card.local && (
                  <a
                    className="ghost"
                    href={card.local}
                    download="face-wars.jpg"
                  >
                    Save card
                  </a>
                )}
                <button className="cta" onClick={startMatch}>
                  Rematch
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}