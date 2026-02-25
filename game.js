/* Pocket Spirits — cozy pixel room prototype
   - Click/tap objects to reveal tiny spirits
   - Dialogue + micro-quests
   - Collect memory fragments
   - Warm pixel-art room inspired by cozy indoor Terraria-style builds
*/

(() => {
  'use strict';

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function now() { return performance.now(); }

  // Tiny blip synth (no external audio)
  class TinyAudio {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }
    toggleMute() { this.muted = !this.muted; }
    beep(freq = 660, dur = 0.06, type = 'sine', gain = 0.03) {
      if (this.muted) return;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t0 = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.01);
      } catch { /* ignore */ }
    }
  }

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  const dialoguePanel = document.getElementById('dialoguePanel');
  const dialogueName = document.getElementById('dialogueName');
  const dialogueText = document.getElementById('dialogueText');
  const choicesEl = document.getElementById('choices');
  const btnContinue = document.getElementById('btnContinue');
  const btnCloseDialogue = document.getElementById('btnCloseDialogue');

  const miniGameArea = document.getElementById('miniGameArea');
  const miniTitle = document.getElementById('miniTitle');
  const miniBody = document.getElementById('miniBody');

  const fragmentsCountEl = document.getElementById('fragmentsCount');
  const fragmentsGrid = document.getElementById('fragmentsGrid');
  const storyNote = document.getElementById('storyNote');
  const tapHint = document.getElementById('tapHint');

  const warmthValue = document.getElementById('warmthValue');

  // ---------- Game State ----------
  const audio = new TinyAudio();

  const TILE = 6; // pixel tile size in screen pixels (virtual)
  const W = canvas.width;
  const H = canvas.height;

  const state = {
    time: 0,
    dt: 0,
    last: now(),
    hoveredId: null,
    pointer: { x: 0, y: 0, down: false, justDown: false },
    dialog: {
      open: false,
      objId: null,
      step: 0,
      locked: false, // while in mini game
    },
    fragments: [],
    warmth: 0, // 0..1, grows as you help
    discoveredAny: false,
  };

  // Pre-fill fragments slots (12)
  const FRAG_SLOTS = 12;
  for (let i = 0; i < FRAG_SLOTS; i++) state.fragments.push(false);

  // ---------- Pixel Drawing Primitives ----------
  function pxRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect((x|0), (y|0), (w|0), (h|0));
  }
  function pxOutline(x, y, w, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect((x|0) + 0.5, (y|0) + 0.5, (w|0) - 1, (h|0) - 1);
  }

  // Soft light (additive-ish using globalAlpha)
  function softGlow(cx, cy, r, color, alpha=0.18) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------- Room Objects / Spirits ----------
  // All object rects are in screen pixels.
  // Each has a hidden spirit + quest state.
  const objects = [
    {
      id: 'toaster',
      name: 'Bramble the Toaster Spirit',
      bounds: { x: 575, y: 312, w: 90, h: 58 },
      hint: 'A toaster sits quietly… but it feels a little tense.',
      spirit: {
        emoji: '🧡',
        colorA: '#ffd48a',
        colorB: '#e68a56',
        mood: 'anxious',
        fragmentIndex: 0,
      },
      quest: {
        stage: 0, // 0 not started, 1 doing, 2 complete
        heat: 0.5,
      },
      script: {
        intro: [
          "…oh! You can see me?",
          "I’m Bramble. I live in warm coils and tiny crumbs.",
          "I’m supposed to toast bread, but… what if I burn it?",
          "Burnt bread smells like disappointment."
        ],
        after: [
          "Thank you for staying with me.",
          "I can do warmth without fear."
        ]
      }
    },
    {
      id: 'lamp',
      name: 'Luma the Lamp Spirit',
      bounds: { x: 292, y: 228, w: 74, h: 132 },
      hint: 'A standing lamp. It looks like it wants to perform.',
      spirit: {
        emoji: '✨',
        colorA: '#fff4c9',
        colorB: '#f0b46b',
        mood: 'shy',
        fragmentIndex: 1,
      },
      quest: {
        stage: 0,
        courage: 0,
        target: 3,
      },
      script: {
        intro: [
          "Hi… I’m Luma.",
          "I love lighting up rooms.",
          "But when people look at me, I… flicker.",
          "Could you help me practice? Just a little glow. Together."
        ],
        after: [
          "I did it. I didn’t run away into dimness.",
          "Your attention felt… gentle."
        ]
      }
    },
    {
      id: 'teacup',
      name: 'Mallow the Teacup Spirit',
      bounds: { x: 712, y: 208, w: 62, h: 56 },
      hint: 'A teacup on the shelf. Something inside is listening.',
      spirit: {
        emoji: '☁️',
        colorA: '#d6c9ff',
        colorB: '#ffcad4',
        mood: 'lonely',
        fragmentIndex: 2,
      },
      quest: {
        stage: 0,
        friendsPlaced: 0,
        needs: 2,
      },
      script: {
        intro: [
          "Oh… hello.",
          "I’m Mallow. I live in little rings of porcelain.",
          "I’m up here all day. It gets… quiet.",
          "Could we make this shelf feel less alone?"
        ],
        after: [
          "It’s not the noise I wanted… it’s the company.",
          "Thank you for making space for me."
        ]
      }
    },
    // Extra “discover only” spirits (no quests yet, but little lore + fragments later)
    {
      id: 'book',
      name: 'Sable the Book Spirit',
      bounds: { x: 184, y: 214, w: 78, h: 82 },
      hint: 'Books breathe when nobody’s looking.',
      spirit: {
        emoji: '📚',
        colorA: '#bce7d6',
        colorB: '#83b3ff',
        mood: 'curious',
        fragmentIndex: 3,
      },
      quest: { stage: 0 },
      script: {
        intro: [
          "I’m Sable, a story folded into paper.",
          "Every time you open a page, I stretch my little legs.",
          "Come back later. I’ll have a memory to share."
        ],
        after: [
          "Books remember hands. Softly. Kindly."
        ]
      }
    },
    {
      id: 'plant',
      name: 'Sprig the Plant Spirit',
      bounds: { x: 84, y: 288, w: 92, h: 108 },
      hint: 'A plant that seems… proud of its leaves.',
      spirit: {
        emoji: '🌿',
        colorA: '#bce7d6',
        colorB: '#ffd48a',
        mood: 'steady',
        fragmentIndex: 4,
      },
      quest: { stage: 0 },
      script: {
        intro: [
          "Hi. I’m Sprig.",
          "I’m learning patience from sunlight.",
          "If you ever forget to breathe, watch leaves. They never hurry."
        ],
        after: [
          "Small days are still days worth living."
        ]
      }
    }
  ];

  // ---------- UI: Fragments ----------
  function renderFragmentsUI() {
    fragmentsGrid.innerHTML = '';
    const found = state.fragments.filter(Boolean).length;
    fragmentsCountEl.textContent = String(found);

    for (let i = 0; i < FRAG_SLOTS; i++) {
      const d = document.createElement('div');
      d.className = 'frag' + (state.fragments[i] ? ' found' : '');
      d.textContent = state.fragments[i] ? '✶' : '·';
      fragmentsGrid.appendChild(d);
    }

    // Gentle “room story” unlock at 3 fragments
    if (found >= 3) {
      storyNote.textContent =
        "The room feels warmer now. The objects don’t feel like objects—" +
        " they feel like neighbors. You notice the quiet has a heartbeat.";
      warmthValue.textContent = '🕯️';
    } else if (found >= 1) {
      storyNote.textContent =
        "You’ve started collecting tiny memories. They feel like warm dust in sunbeams.";
      warmthValue.textContent = '☕';
    } else {
      storyNote.textContent =
        "Find spirits inside everyday objects. Help them with small, wholesome worries.";
      warmthValue.textContent = '🫖';
    }
  }

  function awardFragment(obj) {
    const idx = obj.spirit.fragmentIndex;
    if (idx == null) return;
    if (!state.fragments[idx]) {
      state.fragments[idx] = true;
      state.warmth = clamp(state.warmth + 0.18, 0, 1);
      renderFragmentsUI();
      audio.beep(880, 0.07, 'triangle', 0.04);
      audio.beep(1120, 0.05, 'sine', 0.03);
    }
  }

  // ---------- Dialogue System ----------
  let queuedLines = [];
  let currentObj = null;

  function openDialogue(obj) {
    currentObj = obj;
    state.dialog.open = true;
    state.dialog.objId = obj.id;
    state.dialog.step = 0;
    state.dialog.locked = false;

    state.discoveredAny = true;
    tapHint.style.display = 'none';

    queuedLines = [];
    const isComplete = (obj.quest?.stage === 2);
    const lines = isComplete ? obj.script.after : obj.script.intro;
    queuedLines.push(...lines);

    dialogueName.textContent = obj.name;
    dialoguePanel.classList.remove('hidden');
    miniGameArea.classList.add('hidden');
    choicesEl.innerHTML = '';
    btnContinue.textContent = 'Continue';
    setDialogueText(nextLine());
    renderPortrait(obj);
    audio.beep(640, 0.05, 'sine', 0.03);
  }

  function closeDialogue() {
    state.dialog.open = false;
    state.dialog.objId = null;
    currentObj = null;
    queuedLines = [];
    dialoguePanel.classList.add('hidden');
    choicesEl.innerHTML = '';
    miniGameArea.classList.add('hidden');
    audio.beep(420, 0.05, 'sine', 0.02);
  }

  function nextLine() {
    return queuedLines.length ? queuedLines.shift() : null;
  }

  function setDialogueText(t) {
    dialogueText.textContent = t || '';
  }

  function renderPortrait(obj) {
    // Tiny pixel portrait in a div via CSS background gradient + emoji overlay
    const p = document.getElementById('portrait');
    const a = obj.spirit.colorA;
    const b = obj.spirit.colorB;
    p.style.background = `radial-gradient(circle at 35% 30%, ${a}55, rgba(255,255,255,.06)), radial-gradient(circle at 65% 70%, ${b}35, rgba(0,0,0,.0))`;
    p.textContent = obj.spirit.emoji;
    p.style.display = 'flex';
    p.style.alignItems = 'center';
    p.style.justifyContent = 'center';
    p.style.fontSize = '26px';
    p.style.userSelect = 'none';
  }

  function showChoices(list) {
    choicesEl.innerHTML = '';
    list.forEach(c => {
      const b = document.createElement('div');
      b.className = 'choice';
      b.textContent = c.label;
      b.addEventListener('click', () => c.onPick());
      choicesEl.appendChild(b);
    });
  }

  function startQuestIfAvailable(obj) {
    // Only toaster/lamp/teacup have micro-quests right now
    if (!obj.quest) return;

    if (obj.id === 'toaster' && obj.quest.stage === 0) {
      obj.quest.stage = 1;
      toasterMiniGame(obj);
    } else if (obj.id === 'lamp' && obj.quest.stage === 0) {
      obj.quest.stage = 1;
      lampMiniGame(obj);
    } else if (obj.id === 'teacup' && obj.quest.stage === 0) {
      obj.quest.stage = 1;
      teacupMiniGame(obj);
    } else if ((obj.id === 'book' || obj.id === 'plant') && obj.quest.stage === 0) {
      // “Discover-only” spirits: grant fragment immediately as a gentle reward
      obj.quest.stage = 2;
      awardFragment(obj);
      showChoices([{ label: "Leave them a quiet moment", onPick: () => closeDialogue() }]);
    }
  }

  // ---------- Mini Games ----------
  function toasterMiniGame(obj) {
    state.dialog.locked = true;
    miniGameArea.classList.remove('hidden');
    miniTitle.textContent = 'Toaster Courage';
    miniBody.innerHTML = `
      Bramble worries about burning bread. Set a gentle heat.
      <div class="sliderRow">
        <span>cool</span>
        <input id="heatSlider" type="range" min="0" max="100" value="${Math.round(obj.quest.heat*100)}">
        <span>hot</span>
      </div>
      <div class="gridBtns">
        <button class="smallBtn" id="toastBtn">Toast</button>
        <button class="smallBtn" id="resetBtn">Breathe</button>
        <button class="smallBtn" id="peekBtn">Peek</button>
      </div>
      <div id="toastResult" style="margin-top:10px; opacity:.9;"></div>
    `;

    const heatSlider = miniBody.querySelector('#heatSlider');
    const toastBtn = miniBody.querySelector('#toastBtn');
    const resetBtn = miniBody.querySelector('#resetBtn');
    const peekBtn = miniBody.querySelector('#peekBtn');
    const toastResult = miniBody.querySelector('#toastResult');

    const targetMin = 0.42;
    const targetMax = 0.62;

    const updateHeat = () => {
      obj.quest.heat = clamp(Number(heatSlider.value) / 100, 0, 1);
    };

    heatSlider.addEventListener('input', () => {
      updateHeat();
      audio.beep(520 + obj.quest.heat*380, 0.03, 'sine', 0.015);
    });

    peekBtn.addEventListener('click', () => {
      updateHeat();
      const h = obj.quest.heat;
      if (h < targetMin) toastResult.textContent = "It’s pale… like it never got a chance to be brave.";
      else if (h > targetMax) toastResult.textContent = "It’s getting too intense. Bramble’s coils tense up.";
      else toastResult.textContent = "That’s a cozy warmth. Golden edges. Gentle confidence.";
      audio.beep(720, 0.04, 'triangle', 0.02);
    });

    resetBtn.addEventListener('click', () => {
      heatSlider.value = "50";
      updateHeat();
      toastResult.textContent = "You both take a slow breath. Crumbs settle like tiny snow.";
      audio.beep(440, 0.05, 'sine', 0.02);
    });

    toastBtn.addEventListener('click', () => {
      updateHeat();
      const h = obj.quest.heat;
      let msg = "";
      if (h < targetMin) {
        msg = "The toast is underdone. Bramble whispers: “I can try again… gently.”";
        audio.beep(300, 0.06, 'sine', 0.02);
      } else if (h > targetMax) {
        msg = "A harsh smell threatens. You stop in time. Bramble trembles—then calms.";
        audio.beep(220, 0.07, 'sine', 0.02);
      } else {
        msg = "Perfect. Warm. Safe. Bramble’s fear softens into pride.";
        completeQuest(obj);
      }
      toastResult.textContent = msg;
    });

    showChoices([
      { label: "Stay with Bramble", onPick: () => {} }
    ]);
  }

  function lampMiniGame(obj) {
    state.dialog.locked = true;
    miniGameArea.classList.remove('hidden');
    miniTitle.textContent = 'Lamp Practice';
    miniBody.innerHTML = `
      Luma gets stage fright. Help them “glow on cue” three times.
      <div style="margin-top:10px; opacity:.95;">
        When you feel ready, tap <b>Glow</b> when the little star feels steady.
      </div>
      <div class="gridBtns">
        <button class="smallBtn" id="glowBtn">Glow</button>
        <button class="smallBtn" id="focusBtn">Focus</button>
        <button class="smallBtn" id="stopBtn">Rest</button>
      </div>
      <div id="lampResult" style="margin-top:10px; opacity:.9;"></div>
    `;

    const glowBtn = miniBody.querySelector('#glowBtn');
    const focusBtn = miniBody.querySelector('#focusBtn');
    const stopBtn = miniBody.querySelector('#stopBtn');
    const lampResult = miniBody.querySelector('#lampResult');

    let wobble = 0.0;      // 0..1
    let steadyWindow = 0;  // frames

    // Add a little “timing” feeling: focus reduces wobble
    const tick = () => {
      if (!state.dialog.open || currentObj?.id !== obj.id) return;
      wobble = clamp(wobble + (Math.random()*0.08 - 0.03), 0, 1);
      if (wobble < 0.28) steadyWindow++;
      else steadyWindow = 0;
      requestAnimationFrame(tick);
    };
    tick();

    focusBtn.addEventListener('click', () => {
      wobble = clamp(wobble - 0.22, 0, 1);
      lampResult.textContent = "You hold your attention softly. The light steadies.";
      audio.beep(740, 0.05, 'triangle', 0.02);
    });

    glowBtn.addEventListener('click', () => {
      const good = (steadyWindow >= 10);
      if (good) {
        obj.quest.courage++;
        lampResult.textContent = `A clean, confident glow! (${obj.quest.courage}/${obj.quest.target})`;
        audio.beep(980, 0.06, 'triangle', 0.035);
        audio.beep(1220, 0.05, 'sine', 0.02);
        wobble = clamp(wobble + 0.15, 0, 1); // excitement wobble
        if (obj.quest.courage >= obj.quest.target) completeQuest(obj);
      } else {
        lampResult.textContent = "A nervous flicker. That’s okay. Try again when it feels steady.";
        audio.beep(360, 0.05, 'sine', 0.02);
        wobble = clamp(wobble + 0.08, 0, 1);
      }
    });

    stopBtn.addEventListener('click', () => {
      lampResult.textContent = "You pause. Stage fright loosens when nobody rushes it.";
      audio.beep(420, 0.05, 'sine', 0.02);
    });

    showChoices([{ label: "Cheer for Luma", onPick: () => {} }]);
  }

  function teacupMiniGame(obj) {
    state.dialog.locked = true;
    miniGameArea.classList.remove('hidden');
    miniTitle.textContent = 'A Less-Lonely Shelf';
    miniBody.innerHTML = `
      Mallow feels lonely. Place two tiny “comforts” on the shelf.
      <div style="margin-top:10px; opacity:.95;">
        Choose gentle companions: a sugar cube, a spoon, or a cookie.
      </div>
      <div class="gridBtns">
        <button class="smallBtn" id="placeSugar">Sugar</button>
        <button class="smallBtn" id="placeSpoon">Spoon</button>
        <button class="smallBtn" id="placeCookie">Cookie</button>
      </div>
      <div id="teaResult" style="margin-top:10px; opacity:.9;"></div>
    `;

    const teaResult = miniBody.querySelector('#teaResult');
    const place = (what) => {
      obj.quest.friendsPlaced++;
      audio.beep(760, 0.05, 'triangle', 0.025);
      teaResult.textContent = `${what} placed. The shelf feels a little kinder. (${obj.quest.friendsPlaced}/${obj.quest.needs})`;
      if (obj.quest.friendsPlaced >= obj.quest.needs) completeQuest(obj);
    };

    miniBody.querySelector('#placeSugar').addEventListener('click', () => place('A sugar cube'));
    miniBody.querySelector('#placeSpoon').addEventListener('click', () => place('A spoon'));
    miniBody.querySelector('#placeCookie').addEventListener('click', () => place('A cookie'));

    showChoices([{ label: "Sit with Mallow", onPick: () => {} }]);
  }

  function completeQuest(obj) {
    obj.quest.stage = 2;
    state.dialog.locked = false;
    miniGameArea.classList.add('hidden');

    awardFragment(obj);

    // Post-quest line + exit choice
    queuedLines = [];
    queuedLines.push(...obj.script.after);
    setDialogueText(nextLine());
    showChoices([
      { label: "Thank them", onPick: () => {
          if (queuedLines.length) {
            setDialogueText(nextLine());
            audio.beep(680, 0.05, 'sine', 0.02);
          } else {
            closeDialogue();
          }
        }
      },
      { label: "Leave quietly", onPick: () => closeDialogue() }
    ]);
  }

  // Continue button behavior
  btnContinue.addEventListener('click', () => {
    if (!state.dialog.open || !currentObj) return;

    // If mini game is active/locked, Continue does nothing (keeps it slow and focused)
    if (state.dialog.locked) {
      audio.beep(300, 0.03, 'sine', 0.01);
      return;
    }

    const line = nextLine();
    if (line) {
      setDialogueText(line);
      audio.beep(620, 0.04, 'sine', 0.02);
      return;
    }

    // When script ends, offer quest start or gentle exit
    const isComplete = (currentObj.quest?.stage === 2);
    if (!isComplete) {
      showChoices([
        { label: "Help them with a tiny problem", onPick: () => startQuestIfAvailable(currentObj) },
        { label: "Just keep them company", onPick: () => {
            setDialogueText("You stay for a moment. The room doesn’t ask anything more from you.");
            showChoices([{ label: "Okay", onPick: () => closeDialogue() }]);
            audio.beep(520, 0.05, 'sine', 0.02);
          }
        },
        { label: "Back away gently", onPick: () => closeDialogue() }
      ]);
      btnContinue.textContent = '…';
    } else {
      closeDialogue();
    }
  });

  btnCloseDialogue.addEventListener('click', closeDialogue);

  // Close on Esc
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDialogue();
    if (e.key.toLowerCase() === 'm') audio.toggleMute();
  });

  // ---------- Pointer Handling ----------
  function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const y = (evt.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }

  function onPointerMove(evt) {
    const p = canvasPos(evt);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
  }

  function onPointerDown(evt) {
    const p = canvasPos(evt);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
    state.pointer.down = true;
    state.pointer.justDown = true;
  }

  function onPointerUp() {
    state.pointer.down = false;
  }

  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mouseup', onPointerUp);

  // Touch
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onPointerDown(e.touches[0]);
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    onPointerMove(e.touches[0]);
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    onPointerUp();
  }, { passive: false });

  // ---------- Scene: Pixel Room ----------
  function drawBackgroundSky() {
    // sky already in canvas bg; add a sun-ish glow
    softGlow(120, 90, 180, 'rgba(255,240,200,1)', 0.12);
  }

  function drawRoomShell() {
    // Floor / ground
    pxRect(0, 420, W, 120, '#2a1c12');
    // Dirt edge
    for (let x = 0; x < W; x += 18) {
      pxRect(x, 420, 9, 6, '#1f140d');
    }

    // Wooden house box
    const house = { x: 110, y: 90, w: 740, h: 350 };
    pxRect(house.x, house.y, house.w, house.h, '#3a2618'); // wood mid

    // Inner walls (lighter)
    pxRect(house.x + 18, house.y + 18, house.w - 36, house.h - 36, '#4e3322');

    // Roof / top trim (stone-ish)
    pxRect(house.x, house.y - 18, house.w, 18, '#2b2f3d');
    pxRect(house.x, house.y - 9, house.w, 9, '#3a3f52');

    // Split floor
    pxRect(house.x + 18, house.y + 170, house.w - 36, 10, '#2a1c12');
    pxRect(house.x + 18, house.y + 180, house.w - 36, 6, '#1f140d');

    // Vertical support beams
    for (let i = 0; i < 6; i++) {
      const bx = house.x + 40 + i * 120;
      pxRect(bx, house.y + 18, 10, house.h - 36, '#2a1c12');
      pxRect(bx+2, house.y + 18, 6, house.h - 36, '#1f140d');
    }

    // Windows (simple)
    drawWindow(210, 130, 120, 70);
    drawWindow(635, 130, 140, 70);
    drawWindow(590, 280, 170, 75);

    // Stair / ramp
    drawStairs(640, 360, 180, 76);

    // Warm lamps on walls
    drawWallSconce(360, 205);
    drawWallSconce(520, 205);
    drawWallSconce(360, 335);
    drawWallSconce(520, 335);
  }

  function drawWindow(x, y, w, h) {
    pxRect(x, y, w, h, '#1a263e');
    pxRect(x+6, y+6, w-12, h-12, '#5fa3ff');
    pxRect(x+6, y+6, w-12, 10, '#83b3ff');
    // frame
    pxOutline(x, y, w, h, 'rgba(0,0,0,.35)');
    // crossbars
    pxRect(x + (w/2|0) - 2, y, 4, h, 'rgba(0,0,0,.25)');
    pxRect(x, y + (h/2|0) - 2, w, 4, 'rgba(0,0,0,.25)');
  }

  function drawStairs(x, y, w, h) {
    // angled ramp with steps
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const sx = x + (t * w);
      const sy = y - (t * h);
      pxRect(sx, sy, 28, 10, '#2a1c12');
      pxRect(sx, sy+8, 28, 2, '#1f140d');
    }
  }

  function drawWallSconce(x, y) {
    // mount
    pxRect(x, y, 14, 10, '#2a1c12');
    pxRect(x+4, y+10, 6, 12, '#2a1c12');
    // flame
    pxRect(x+3, y-6, 8, 8, '#f6d7a7');
    pxRect(x+4, y-4, 6, 6, '#f0b46b');
    softGlow(x+7, y-2, 70, 'rgba(255,210,150,1)', 0.22);
  }

  function drawFurnitureAndProps() {
    // Bookshelf (upper left)
    drawBookshelf(160, 180, 120, 110);

    // Lamp stand (upper middle-left) - clickable lamp is here
    drawStandingLamp(300, 210);

    // Bed-ish cozy nook (upper right)
    drawBed(660, 184);

    // Kitchen counter + toaster (lower right-ish)
    drawCounter(540, 320);

    // Shelf with teacup (upper right shelf)
    drawShelf(660, 200);

    // Plant (lower left-ish)
    drawPlant(86, 300);

    // Table & clock vibe (lower left center)
    drawSmallTable(220, 330);
  }

  function drawBookshelf(x, y, w, h) {
    pxRect(x, y, w, h, '#2a1c12');
    pxRect(x+6, y+6, w-12, h-12, '#3a2618');
    // shelves
    for (let i = 0; i < 3; i++) {
      pxRect(x+8, y+20 + i*28, w-16, 6, '#2a1c12');
    }
    // books
    for (let i = 0; i < 10; i++) {
      const bx = x + 12 + i*9;
      const by = y + 10 + (i%2)*2;
      pxRect(bx, by, 6, 22, i%3===0 ? '#bce7d6' : (i%3===1 ? '#d6c9ff' : '#ffcad4'));
      pxRect(bx, by+18, 6, 4, '#1f140d');
    }
    // secret “book spirit” shimmer
    softGlow(x+60, y+40, 42, 'rgba(188,231,214,1)', 0.12);
  }

  function drawStandingLamp(x, y) {
    // pole
    pxRect(x+30, y+24, 8, 84, '#2a1c12');
    pxRect(x+28, y+106, 12, 10, '#2a1c12');
    // shade
    pxRect(x+16, y, 36, 26, '#fff4e3');
    pxRect(x+18, y+2, 32, 22, '#f6d7a7');
    pxRect(x+22, y+6, 24, 14, '#f0b46b');
    // glow
    softGlow(x+34, y+12, 110, 'rgba(255,220,170,1)', 0.18);
  }

  function drawBed(x, y) {
    // platform
    pxRect(x, y+40, 150, 46, '#2a1c12');
    pxRect(x+6, y+46, 138, 34, '#3a2618');
    // blanket
    pxRect(x+10, y+50, 130, 26, '#d6c9ff');
    pxRect(x+10, y+50, 130, 8, '#ffcad4');
    // pillow
    pxRect(x+20, y+44, 42, 16, '#fff4e3');
    pxRect(x+22, y+46, 38, 12, '#bce7d6');
  }

  function drawCounter(x, y) {
    pxRect(x, y, 200, 60, '#2a1c12');
    pxRect(x+8, y+8, 184, 44, '#3a2618');
    // toaster block (clickable zone aligned with toaster bounds)
    const t = objects.find(o => o.id === 'toaster');
    const b = t.bounds;
    pxRect(b.x, b.y+18, b.w, b.h-18, '#5a5f6b');
    pxRect(b.x+8, b.y+24, b.w-16, b.h-30, '#3a3f52');
    pxRect(b.x+10, b.y+26, b.w-20, 8, '#83b3ff');
    // slots
    pxRect(b.x+16, b.y+18, 18, 6, '#1a0f0b');
    pxRect(b.x+38, b.y+18, 18, 6, '#1a0f0b');
    // knob
    pxRect(b.x+b.w-22, b.y+30, 10, 10, '#ffd48a');
    softGlow(b.x+b.w/2, b.y+b.h/2, 54, 'rgba(255,210,150,1)', 0.10);
  }

  function drawShelf(x, y) {
    pxRect(x, y, 160, 10, '#2a1c12');
    pxRect(x, y+10, 160, 4, '#1f140d');

    // teacup (clickable bounds aligned)
    const cup = objects.find(o => o.id === 'teacup');
    const b = cup.bounds;
    pxRect(b.x+6, b.y+20, b.w-12, 22, '#fff4e3');
    pxRect(b.x+8, b.y+22, b.w-16, 18, '#ffcad4');
    // handle
    pxRect(b.x+b.w-10, b.y+26, 8, 14, '#fff4e3');
    pxRect(b.x+b.w-8, b.y+28, 4, 10, '#ffcad4');
    softGlow(b.x+b.w/2, b.y+30, 46, 'rgba(214,201,255,1)', 0.10);
  }

  function drawPlant(x, y) {
    // pot
    pxRect(x+18, y+66, 42, 30, '#e68a56');
    pxRect(x+20, y+70, 38, 22, '#f0b46b');
    pxRect(x+24, y+74, 30, 14, '#3a2618');
    // stem + leaves
    pxRect(x+38, y+20, 6, 50, '#2a1c12');
    for (let i = 0; i < 7; i++) {
      const lx = x + 14 + i*10;
      const ly = y + 22 + (i%2)*6;
      pxRect(lx, ly, 18, 10, '#bce7d6');
      pxRect(lx+2, ly+2, 14, 6, '#83d1b4');
    }
    softGlow(x+40, y+40, 70, 'rgba(188,231,214,1)', 0.12);
  }

  function drawSmallTable(x, y) {
    pxRect(x, y+50, 110, 12, '#2a1c12');
    pxRect(x+10, y+62, 10, 36, '#2a1c12');
    pxRect(x+90, y+62, 10, 36, '#2a1c12');
    // candle-ish
    pxRect(x+50, y+24, 10, 26, '#fff4e3');
    pxRect(x+52, y+18, 6, 8, '#f6d7a7');
    softGlow(x+55, y+18, 90, 'rgba(255,220,170,1)', 0.20);
  }

  function drawObjectHighlights() {
    // Hover outlines / subtle shimmer where spirits are
    const hover = state.hoveredId;
    objects.forEach(o => {
      const b = o.bounds;
      const t = (Math.sin(state.time*1.8 + hashId(o.id)*2) * 0.5 + 0.5);
      const shimmer = lerp(0.05, 0.12, t);

      // faint spirit glow always
      softGlow(b.x + b.w/2, b.y + b.h/2, Math.max(b.w, b.h)*0.9, 'rgba(255,220,170,1)', shimmer);

      if (hover === o.id) {
        pxOutline(b.x, b.y, b.w, b.h, 'rgba(255,244,227,.65)');
        softGlow(b.x + b.w/2, b.y + b.h/2, Math.max(b.w,b.h)*1.1, 'rgba(255,220,170,1)', 0.16);
      }
    });
  }

  function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0;
    return (h >>> 0) / 4294967295;
  }

  function drawTinySpiritsAmbient() {
    // Little floating “motes” and occasional tiny spirit peeks
    const motes = 28;
    for (let i = 0; i < motes; i++) {
      const t = state.time * 0.35 + i * 12.3;
      const x = (i*97 + (Math.sin(t)*120)) % W;
      const y = 120 + (i*43 + (Math.cos(t*1.2)*60)) % 360;
      const a = 0.04 + (Math.sin(t*2.2)*0.02 + 0.02);
      pxRect(x, y, 2, 2, `rgba(255,220,170,${a})`);
    }

    // “Peek” a tiny blob spirit above completed objects
    objects.forEach(o => {
      if (o.quest?.stage === 2) {
        const b = o.bounds;
        const bob = Math.sin(state.time*2 + hashId(o.id)*10) * 4;
        drawSpiritBlob(b.x + b.w/2, b.y - 10 + bob, o.spirit);
      }
    });
  }

  function drawSpiritBlob(cx, cy, spirit) {
    // Simple pixel blob + face
    const s = 18;
    const x = (cx - s/2)|0;
    const y = (cy - s/2)|0;

    pxRect(x+4, y+6, 10, 10, spirit.colorA);
    pxRect(x+6, y+4, 6, 14, spirit.colorA);
    pxRect(x+6, y+8, 6, 6, spirit.colorB);

    // eyes
    pxRect(x+7, y+9, 2, 2, '#1a0f0b');
    pxRect(x+11, y+9, 2, 2, '#1a0f0b');
    // blush
    pxRect(x+6, y+12, 2, 1, 'rgba(255,202,212,.9)');
    pxRect(x+13, y+12, 2, 1, 'rgba(255,202,212,.9)');
    softGlow(cx, cy, 50, 'rgba(255,220,170,1)', 0.12);
  }

  // ---------- Interaction ----------
  function updateHover() {
    state.hoveredId = null;
    const mx = state.pointer.x;
    const my = state.pointer.y;
    for (const o of objects) {
      const b = o.bounds;
      if (mx >= b.x && mx <= b.x+b.w && my >= b.y && my <= b.y+b.h) {
        state.hoveredId = o.id;
        return;
      }
    }
  }

  function handleClick() {
    if (!state.pointer.justDown) return;
    state.pointer.justDown = false;

    if (state.dialog.open) return; // clicks go to UI while dialogue open

    if (state.hoveredId) {
      const obj = objects.find(o => o.id === state.hoveredId);
      if (obj) {
        openDialogue(obj);
        audio.beep(700, 0.05, 'triangle', 0.03);
      }
    } else {
      audio.beep(260, 0.03, 'sine', 0.01);
    }
  }

  // ---------- Main Loop ----------
  function tick() {
    const t = now();
    state.dt = Math.min(0.033, (t - state.last) / 1000);
    state.last = t;
    state.time += state.dt;

    updateHover();
    handleClick();

    draw();

    requestAnimationFrame(tick);
  }

  function draw() {
    // Clear
    ctx.clearRect(0, 0, W, H);

    // Sky-ish background + soft light
    drawBackgroundSky();

    // House / room
    drawRoomShell();

    // Props
    drawFurnitureAndProps();

    // Ambient spirits + motes
    drawTinySpiritsAmbient();

    // Hover highlights
    drawObjectHighlights();

    // Cozy global warm overlay inside house (soft “lighting”)
    drawWarmOverlay();
  }

  function drawWarmOverlay() {
    // A warm tone glaze inside the room area
    ctx.save();
    ctx.globalAlpha = 0.18 + state.warmth * 0.10;
    const g = ctx.createLinearGradient(0, 120, 0, 520);
    g.addColorStop(0, 'rgba(255,214,167,0.20)');
    g.addColorStop(1, 'rgba(230,138,86,0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(100, 80, 760, 380);
    ctx.restore();
  }

  // ---------- Boot ----------
  function init() {
    renderFragmentsUI();

    // “Tap an object” hint fades after first discovery
    const hintPulse = () => {
      if (state.discoveredAny) return;
      const t = state.time;
      tapHint.style.opacity = String(0.75 + Math.sin(t*2.0)*0.15);
      requestAnimationFrame(hintPulse);
    };
    hintPulse();

    tick();
  }

  init();
})();
