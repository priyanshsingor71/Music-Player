(() => {
    "use strict";

    /* =====================================================
       YOUR SONGS  — edit this list to add more built-in songs
       (src = audio file, art = cover image, hue = accent colour 0-360)
    ===================================================== */
    const tracks = [
        { id: 1, title: "Sheesa",              src: "1.mp3", art: "1.png", hue: 150 },
        { id: 2, title: "Montegam Alqumanium", src: "2.mp3", art: "2.png", hue: 285 },
        { id: 3, title: "Safar",               src: "3.mp3", art: "3.png", hue: 25  },
        { id: 4, title: "Mera Mann (unplugged)", src: "4.mp3", art: "4.png", hue: 200 }
    ];
    let nextId = 100;   // ids for songs the user adds while using the player

    /* ---------- helpers ---------- */
    const $ = (s) => document.querySelector(s);
    const root = document.documentElement;
    const store = {
        get(k, d) { try { const v = localStorage.getItem("pn_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
        set(k, v) { try { localStorage.setItem("pn_" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
    };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (s) => {
        if (!isFinite(s)) return "0:00";
        const m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return m + ":" + String(sec).padStart(2, "0");
    };

    const el = {
        player: $("#player"), art: $("#art"), artImg: $("#artImg"), glow: $("#glow"),
        meta: $("#meta"), title: $("#title"), subtitle: $("#subtitle"),
        viz: $("#viz"), bg: $("#bg"),
        seek: $("#seek"), cur: $("#cur"), dur: $("#dur"),
        shuffle: $("#shuffleBtn"), prev: $("#prevBtn"), play: $("#playBtn"), next: $("#nextBtn"), repeat: $("#repeatBtn"),
        volume: $("#volume"), mute: $("#muteBtn"), speed: $("#speed"), sleep: $("#sleep"), favMain: $("#favMain"),
        list: $("#list"), search: $("#search"), countAll: $("#countAll"), countFav: $("#countFav"),
        theme: $("#themeBtn"), add: $("#addBtn"), file: $("#fileInput"),
        help: $("#help"), helpBtn: $("#helpBtn"), helpClose: $("#helpClose"),
        toast: $("#toast"), drop: $("#drop")
    };

    const ICON_PLAY = '<svg viewBox="0 0 24 24" class="fill"><path d="M8 5v14l11-7z"/></svg>';
    const ICON_PAUSE = '<svg viewBox="0 0 24 24" class="fill"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

    /* ---------- state ---------- */
    const audio = new Audio();
    audio.preload = "metadata";

    let cur = -1;
    let tab = "all";
    let query = "";
    let shuffle = store.get("shuffle", false);
    let repeat = store.get("repeat", "off");       // off | all | one
    let vol = store.get("vol", 1);
    let muted = store.get("muted", false);
    let speed = store.get("speed", 1);
    let favs = new Set(store.get("favs", []));
    let history = [];                              // for "previous" while shuffling
    let seeking = false;
    let pendingTime = 0;
    let sleepTimer = null;
    let lastSave = 0;
    let dragId = null;

    /* accent hue (eased every frame) */
    let hue = tracks[0].hue, targetHue = hue, lastHueShown = -1;

    /* =====================================================
       AUDIO ANALYSER (real visualiser)
       Browsers block reading audio data from files opened
       directly (file://). In that case we use a lively
       simulated visualiser. Run with a local server
       (e.g. VS Code "Live Server") for the real one.
    ===================================================== */
    let ac = null, analyser = null, freq = null;

    function setupAnalyser() {
        if (ac || !/^https?:$/.test(location.protocol)) return;
        try {
            ac = new (window.AudioContext || window.webkitAudioContext)();
            const src = ac.createMediaElementSource(audio);
            analyser = ac.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            src.connect(analyser);
            analyser.connect(ac.destination);
            freq = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            analyser = null;
        }
    }

    /* =====================================================
       TOAST
    ===================================================== */
    let toastTimer;
    function toast(msg) {
        el.toast.textContent = msg;
        el.toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
    }

    /* =====================================================
       PLAYBACK
    ===================================================== */
    const isPlaying = () => !audio.paused && !audio.ended;

    async function play() {
        if (cur < 0) return;
        setupAnalyser();
        if (ac && ac.state === "suspended") ac.resume();
        try { await audio.play(); }
        catch (e) { if (e.name !== "AbortError") toast("Can't play this file. Check that " + tracks[cur].src + " exists."); }
    }

    function pause() { audio.pause(); }
    function togglePlay() { isPlaying() ? pause() : play(); }

    function loadTrack(i, opts = {}) {
        if (i < 0 || i >= tracks.length) return;
        cur = i;
        const t = tracks[i];

        audio.src = t.src;
        audio.defaultPlaybackRate = speed;
        audio.playbackRate = speed;
        pendingTime = opts.time || 0;

        targetHue = t.hue;
        el.title.textContent = t.title;
        el.subtitle.textContent = t.user ? "Added by you" : "Track " + (i + 1) + " of " + tracks.length;
        el.meta.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "ease-out" });

        el.art.classList.remove("noimg");
        if (t.art) {
            el.artImg.onerror = () => el.art.classList.add("noimg");
            el.artImg.src = t.art;
        } else {
            el.artImg.removeAttribute("src");
            el.art.classList.add("noimg");
        }

        el.seek.value = 0;
        paintRange(el.seek, 0);
        el.cur.textContent = "0:00";
        el.dur.textContent = t.duration ? fmt(t.duration) : "0:00";

        updateFavUI();
        renderList();
        updateMediaSession();
        store.set("last", { id: t.id, time: 0 });
        document.title = t.title + " · PN Media Player";

        if (opts.autoplay) play();
    }

    function pickRandom() {
        if (tracks.length < 2) return cur;
        let n;
        do { n = Math.floor(Math.random() * tracks.length); } while (n === cur);
        return n;
    }

    function next(auto = false) {
        if (!tracks.length) return;
        if (cur >= 0) history.push(cur);
        if (history.length > 50) history.shift();

        let n;
        if (shuffle) n = pickRandom();
        else {
            n = cur + 1;
            if (n >= tracks.length) {
                if (auto && repeat === "off") { pause(); audio.currentTime = 0; return; }
                n = 0;
            }
        }
        loadTrack(n, { autoplay: true });
    }

    function prev() {
        if (!tracks.length) return;
        if (audio.currentTime > 3) { audio.currentTime = 0; return; }
        let n;
        if (shuffle && history.length) n = history.pop();
        else n = cur - 1 < 0 ? tracks.length - 1 : cur - 1;
        loadTrack(n, { autoplay: true });
    }

    function seekBy(sec) {
        if (!isFinite(audio.duration)) return;
        audio.currentTime = clamp(audio.currentTime + sec, 0, audio.duration);
        updateSeek();
    }

    /* ---------- audio events ---------- */
    audio.addEventListener("play", () => setPlayingUI(true));
    audio.addEventListener("pause", () => setPlayingUI(false));
    audio.addEventListener("ended", () => {
        if (repeat === "one") { audio.currentTime = 0; play(); }
        else next(true);
    });
    audio.addEventListener("loadedmetadata", () => {
        if (cur >= 0) tracks[cur].duration = audio.duration;
        if (pendingTime && pendingTime < audio.duration) audio.currentTime = pendingTime;
        pendingTime = 0;
        el.dur.textContent = fmt(audio.duration);
        renderList();
    });
    audio.addEventListener("timeupdate", () => {
        const now = Date.now();
        if (cur >= 0 && now - lastSave > 2000) {
            lastSave = now;
            store.set("last", { id: tracks[cur].id, time: audio.currentTime });
        }
    });
    audio.addEventListener("error", () => {
        if (cur >= 0 && audio.src) toast("Couldn't load “" + tracks[cur].title + "”. Check the file name.");
    });

    function setPlayingUI(on) {
        el.player.classList.toggle("playing", on);
        document.body.classList.toggle("is-playing", on);
        el.play.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
        el.play.setAttribute("aria-label", on ? "Pause" : "Play");
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = on ? "playing" : "paused";
        if (cur >= 0) document.title = (on ? "▶ " : "") + tracks[cur].title + " · PN Media Player";
    }

    /* =====================================================
       SEEK / VOLUME
    ===================================================== */
    function paintRange(input, pct) { input.style.setProperty("--p", pct + "%"); }

    function updateSeek() {
        const d = audio.duration;
        if (!isFinite(d) || d <= 0) return;
        const p = (audio.currentTime / d) * 1000;
        if (!seeking) {
            el.seek.value = p;
            paintRange(el.seek, p / 10);
        }
        el.cur.textContent = fmt(audio.currentTime);
    }

    el.seek.addEventListener("input", () => {
        seeking = true;
        const p = +el.seek.value;
        paintRange(el.seek, p / 10);
        if (isFinite(audio.duration)) {
            el.cur.textContent = fmt((p / 1000) * audio.duration);
        }
    });
    el.seek.addEventListener("change", () => {
        if (isFinite(audio.duration)) audio.currentTime = (+el.seek.value / 1000) * audio.duration;
        seeking = false;
        el.seek.blur();
    });

    function applyVolume() {
        audio.volume = vol;
        audio.muted = muted;
        const shown = muted ? 0 : vol * 100;
        el.volume.value = shown;
        paintRange(el.volume, shown);
        el.mute.textContent = muted || vol === 0 ? "🔇" : vol < 0.5 ? "🔉" : "🔊";
        store.set("vol", vol);
        store.set("muted", muted);
    }

    el.volume.addEventListener("input", () => {
        vol = el.volume.value / 100;
        muted = vol === 0;
        applyVolume();
    });
    el.volume.addEventListener("change", () => el.volume.blur());
    el.mute.addEventListener("click", () => { muted = !muted; if (!muted && vol === 0) vol = 0.5; applyVolume(); });

    el.speed.addEventListener("change", () => {
        speed = +el.speed.value;
        audio.defaultPlaybackRate = speed;
        audio.playbackRate = speed;
        store.set("speed", speed);
        toast("Speed " + speed + "×");
        el.speed.blur();
    });

    /* ---------- sleep timer ---------- */
    el.sleep.addEventListener("change", () => {
        clearTimeout(sleepTimer);
        const m = +el.sleep.value;
        el.sleep.blur();
        if (!m) { toast("Sleep timer off"); return; }
        toast("Music will fade out in " + m + " min");
        sleepTimer = setTimeout(fadeOut, m * 60000);
    });

    function fadeOut() {
        let v = audio.volume;
        const step = v / 30;
        const iv = setInterval(() => {
            v -= step;
            if (v <= 0.01) {
                clearInterval(iv);
                pause();
                applyVolume();
                el.sleep.value = "0";
                toast("Sleep timer finished 🌙");
            } else audio.volume = v;
        }, 100);
    }

    /* =====================================================
       SHUFFLE / REPEAT / FAVORITES / THEME
    ===================================================== */
    function updateModeUI() {
        el.shuffle.setAttribute("aria-pressed", shuffle);
        el.repeat.setAttribute("aria-pressed", repeat !== "off");
        el.repeat.classList.toggle("repeat-one", repeat === "one");
    }

    function toggleShuffle() {
        shuffle = !shuffle;
        store.set("shuffle", shuffle);
        updateModeUI();
        toast(shuffle ? "Shuffle on" : "Shuffle off");
    }

    function cycleRepeat() {
        repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
        store.set("repeat", repeat);
        updateModeUI();
        toast({ off: "Repeat off", all: "Repeat all", one: "Repeat this song" }[repeat]);
    }

    function toggleFav(id) {
        favs.has(id) ? favs.delete(id) : favs.add(id);
        store.set("favs", [...favs].filter((x) => x < 100));
        updateFavUI();
        renderList();
        if (cur >= 0 && tracks[cur].id === id) {
            el.favMain.classList.remove("on");
            void el.favMain.offsetWidth;
            if (favs.has(id)) el.favMain.classList.add("on");
        }
    }

    function updateFavUI() {
        const on = cur >= 0 && favs.has(tracks[cur].id);
        el.favMain.textContent = on ? "❤️" : "🤍";
        el.countAll.textContent = tracks.length;
        el.countFav.textContent = tracks.filter((t) => favs.has(t.id)).length;
    }

    function setTheme(t) {
        root.dataset.theme = t;
        el.theme.textContent = t === "light" ? "☀️" : "🌙";
        store.set("theme", t);
    }

    el.theme.addEventListener("click", () => setTheme(root.dataset.theme === "light" ? "dark" : "light"));
    el.favMain.addEventListener("click", () => { if (cur >= 0) toggleFav(tracks[cur].id); });

    /* =====================================================
       PLAYLIST
    ===================================================== */
    function renderList() {
        const q = query.trim().toLowerCase();
        const items = tracks.filter((t) => (tab === "all" || favs.has(t.id)) && t.title.toLowerCase().includes(q));
        const canDrag = tab === "all" && !q;
        const curId = cur >= 0 ? tracks[cur].id : null;

        el.countAll.textContent = tracks.length;
        el.countFav.textContent = tracks.filter((t) => favs.has(t.id)).length;

        if (!items.length) {
            el.list.innerHTML = '<li class="empty">' + (
                q ? "No songs match “" + esc(query) + "”."
                : tab === "fav" ? "No favorites yet. Tap the heart on any song to save it here."
                : "Your playlist is empty. Use “Add songs” to get started.") + "</li>";
            return;
        }

        el.list.innerHTML = items.map((t) => {
            const isCur = t.id === curId;
            return '<li class="item' + (isCur ? " current" : "") + (t.user ? " user" : "") + '" data-id="' + t.id + '"' + (canDrag ? ' draggable="true"' : "") + ">" +
                '<div class="thumb">' + (t.art ? '<img src="' + esc(t.art) + '" alt="" onerror="this.remove()">' : "🎵") +
                '<div class="eq"><i></i><i></i><i></i></div></div>' +
                '<span class="name" title="' + esc(t.title) + '">' + esc(t.title) + "</span>" +
                '<span class="time">' + (t.duration ? fmt(t.duration) : "–:––") + "</span>" +
                '<button class="fav" title="Favorite" aria-label="Favorite">' + (favs.has(t.id) ? "❤️" : "🤍") + "</button>" +
                '<button class="rm" title="Remove" aria-label="Remove">✕</button></li>';
        }).join("");
    }

    el.list.addEventListener("click", (e) => {
        const li = e.target.closest(".item");
        if (!li) return;
        const id = +li.dataset.id;
        if (e.target.closest(".fav")) return toggleFav(id);
        if (e.target.closest(".rm")) return removeTrack(id);
        const i = tracks.findIndex((t) => t.id === id);
        if (i === cur) togglePlay();
        else { if (cur >= 0) history.push(cur); loadTrack(i, { autoplay: true }); }
    });

    /* drag to reorder */
    el.list.addEventListener("dragstart", (e) => {
        const li = e.target.closest(".item");
        if (!li) return;
        dragId = +li.dataset.id;
        li.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragId));
    });
    el.list.addEventListener("dragover", (e) => {
        if (dragId === null) return;
        e.preventDefault();
        const li = e.target.closest(".item");
        el.list.querySelectorAll(".over").forEach((n) => n.classList.remove("over"));
        if (li && +li.dataset.id !== dragId) li.classList.add("over");
    });
    el.list.addEventListener("drop", (e) => {
        if (dragId === null) return;
        e.preventDefault();
        const li = e.target.closest(".item");
        if (li) {
            const curId = cur >= 0 ? tracks[cur].id : null;
            const from = tracks.findIndex((t) => t.id === dragId);
            const to = tracks.findIndex((t) => t.id === +li.dataset.id);
            if (from > -1 && to > -1 && from !== to) {
                const [moved] = tracks.splice(from, 1);
                tracks.splice(to, 0, moved);
                cur = tracks.findIndex((t) => t.id === curId);
            }
        }
        dragId = null;
        renderList();
    });
    el.list.addEventListener("dragend", () => { dragId = null; renderList(); });

    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
        tab = b.dataset.tab;
        document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
        renderList();
    }));

    el.search.addEventListener("input", () => { query = el.search.value; renderList(); });

    /* =====================================================
       ADD YOUR OWN SONGS (button or drag & drop)
    ===================================================== */
    function preloadDuration(t) {
        const a = new Audio();
        a.preload = "metadata";
        a.src = t.src;
        a.addEventListener("loadedmetadata", () => { t.duration = a.duration; renderList(); });
    }

    function addFiles(files) {
        const audioFiles = [...files].filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(f.name));
        if (!audioFiles.length) return toast("Those aren't audio files.");
        audioFiles.forEach((f) => {
            const t = {
                id: nextId++,
                title: f.name.replace(/\.[^.]+$/, ""),
                src: URL.createObjectURL(f),
                art: null,
                hue: Math.floor(Math.random() * 360),
                user: true
            };
            tracks.push(t);
            preloadDuration(t);
        });
        toast(audioFiles.length + (audioFiles.length > 1 ? " songs added" : " song added"));
        if (cur < 0) loadTrack(0, { autoplay: false }); else renderList();
        updateFavUI();
    }

    function removeTrack(id) {
        const i = tracks.findIndex((t) => t.id === id);
        if (i < 0) return;
        const wasCurrent = i === cur;
        if (tracks[i].user) URL.revokeObjectURL(tracks[i].src);
        tracks.splice(i, 1);
        favs.delete(id);
        history = history.filter((h) => h !== i).map((h) => (h > i ? h - 1 : h));
        if (wasCurrent) {
            audio.pause();
            if (tracks.length) loadTrack(Math.min(i, tracks.length - 1), { autoplay: false });
            else { cur = -1; audio.removeAttribute("src"); el.title.textContent = "Nothing playing"; el.subtitle.textContent = "Add some songs"; setPlayingUI(false); }
        } else if (i < cur) cur--;
        updateFavUI();
        renderList();
    }

    el.add.addEventListener("click", () => el.file.click());
    el.file.addEventListener("change", () => { addFiles(el.file.files); el.file.value = ""; });

    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; el.drop.classList.add("show"); } });
    window.addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; el.drop.classList.remove("show"); } });
    window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        el.drop.classList.remove("show");
        addFiles(e.dataTransfer.files);
    });

    /* =====================================================
       MEDIA KEYS / LOCK-SCREEN CONTROLS
    ===================================================== */
    function updateMediaSession() {
        if (!("mediaSession" in navigator) || cur < 0) return;
        const t = tracks[cur];
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: t.title,
                artist: "PN Media Player",
                artwork: t.art ? [{ src: t.art, sizes: "512x512" }] : []
            });
        } catch { /* ignore */ }
    }

    if ("mediaSession" in navigator) {
        const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
        set("play", play);
        set("pause", pause);
        set("previoustrack", prev);
        set("nexttrack", () => next(false));
        set("seekbackward", () => seekBy(-10));
        set("seekforward", () => seekBy(10));
    }

    /* =====================================================
       KEYBOARD SHORTCUTS
    ===================================================== */
    el.play.addEventListener("click", () => { togglePlay(); el.play.blur(); });
    el.next.addEventListener("click", () => { next(false); el.next.blur(); });
    el.prev.addEventListener("click", () => { prev(); el.prev.blur(); });
    el.shuffle.addEventListener("click", () => { toggleShuffle(); el.shuffle.blur(); });
    el.repeat.addEventListener("click", () => { cycleRepeat(); el.repeat.blur(); });

    el.helpBtn.addEventListener("click", () => el.help.showModal());
    el.helpClose.addEventListener("click", () => el.help.close());
    el.help.addEventListener("click", (e) => { if (e.target === el.help) el.help.close(); });

    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const typing = e.target.matches("input[type='text']");
        if (typing) { if (e.key === "Escape") e.target.blur(); return; }
        if (el.help.open) return;

        const k = e.key.toLowerCase();
        const handled = {
            " ": togglePlay,
            "arrowright": () => seekBy(5),
            "arrowleft": () => seekBy(-5),
            "arrowup": () => { vol = clamp(vol + 0.05, 0, 1); muted = false; applyVolume(); },
            "arrowdown": () => { vol = clamp(vol - 0.05, 0, 1); applyVolume(); },
            "n": () => next(false),
            "p": prev,
            "s": toggleShuffle,
            "r": cycleRepeat,
            "m": () => { muted = !muted; applyVolume(); },
            "f": () => { if (cur >= 0) toggleFav(tracks[cur].id); },
            "t": () => setTheme(root.dataset.theme === "light" ? "dark" : "light"),
            "/": () => el.search.focus(),
            "?": () => el.help.showModal()
        }[k];

        if (handled) { e.preventDefault(); handled(); }
    });
    document.addEventListener("keyup", (e) => {
        if (e.key === " " && !e.target.matches("input[type='text']")) e.preventDefault();
    });

    /* =====================================================
       VISUALISER (bars) + PARTICLE BACKGROUND
    ===================================================== */
    const vctx = el.viz.getContext("2d");
    const bctx = el.bg.getContext("2d");
    const BARS = 56;
    const levels = new Float32Array(BARS);
    let energy = 0;
    let vw = 0, vh = 0;
    const mouse = { x: -9999, y: -9999 };
    let particles = [];

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = el.viz.getBoundingClientRect();
        vw = r.width; vh = r.height;
        el.viz.width = vw * dpr; el.viz.height = vh * dpr;
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        el.bg.width = window.innerWidth * dpr;
        el.bg.height = window.innerHeight * dpr;
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const count = Math.round(clamp(window.innerWidth / 14, 30, 100));
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            r: Math.random() * 2 + 0.8,
            dx: (Math.random() - 0.5) * 0.5,
            dy: (Math.random() - 0.5) * 0.5
        }));
    }
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });

    function sampleLevels(t) {
        const playing = isPlaying();
        let real = false;

        if (analyser && playing) {
            analyser.getByteFrequencyData(freq);
            const usable = freq.length * 0.75;
            for (let i = 0; i < BARS; i++) {
                const idx = Math.floor(Math.pow(i / BARS, 1.5) * usable);
                levels[i] += ((freq[idx] / 255) - levels[i]) * 0.5;
            }
            real = true;
        }

        if (!real) {
            const beat = Math.max(0, Math.sin(t / 260)) * 0.18;
            for (let i = 0; i < BARS; i++) {
                const f = 1 - (i / BARS) * 0.55;
                const target = playing
                    ? clamp((0.35 + 0.22 * Math.sin(t / 420 + i * 0.5) + 0.18 * Math.sin(t / 170 + i * 1.3) + beat) * f, 0.04, 1)
                    : 0;
                levels[i] += (target - levels[i]) * 0.14;
            }
        }

        let sum = 0;
        for (let i = 0; i < 8; i++) sum += levels[i];
        energy += ((sum / 8) - energy) * 0.25;
    }

    function drawBars() {
        vctx.clearRect(0, 0, vw, vh);
        const slot = vw / BARS;
        const bw = slot * 0.6;
        const g = vctx.createLinearGradient(0, vh, 0, 0);
        g.addColorStop(0, "hsl(" + hue + " 85% 55%)");
        g.addColorStop(1, "hsl(" + (hue + 45) + " 90% 65%)");
        vctx.fillStyle = g;

        for (let i = 0; i < BARS; i++) {
            const h = Math.max(3, levels[i] * vh);
            const x = i * slot + (slot - bw) / 2;
            vctx.beginPath();
            if (vctx.roundRect) vctx.roundRect(x, vh - h, bw, h, bw / 2);
            else vctx.rect(x, vh - h, bw, h);
            vctx.fill();
        }
    }

    function drawParticles() {
        const W = window.innerWidth, H = window.innerHeight;
        const light = root.dataset.theme === "light";
        const lum = light ? 32 : 72;
        bctx.clearRect(0, 0, W, H);
        const boost = 1 + energy * 3.5;

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            const mx = p.x - mouse.x, my = p.y - mouse.y;
            const md = Math.hypot(mx, my);
            if (md < 130 && md > 0) { p.x += (mx / md) * 1.8; p.y += (my / md) * 1.8; }

            p.x += p.dx * boost;
            p.y += p.dy * boost;
            if (p.x < 0 || p.x > W) p.dx *= -1;
            if (p.y < 0 || p.y > H) p.dy *= -1;

            bctx.beginPath();
            bctx.arc(p.x, p.y, p.r + energy * 2.4, 0, Math.PI * 2);
            bctx.fillStyle = "hsla(" + hue + ",80%," + lum + "%,.7)";
            bctx.fill();

            for (let j = i + 1; j < particles.length; j++) {
                const q = particles[j];
                const d = Math.hypot(p.x - q.x, p.y - q.y);
                if (d < 115) {
                    bctx.strokeStyle = "hsla(" + hue + ",80%," + lum + "%," + (0.16 * (1 - d / 115) + energy * 0.08) + ")";
                    bctx.lineWidth = 1;
                    bctx.beginPath();
                    bctx.moveTo(p.x, p.y);
                    bctx.lineTo(q.x, q.y);
                    bctx.stroke();
                }
            }
        }
    }

    function frame(t) {
        requestAnimationFrame(frame);

        /* ease accent colour along the shortest path around the colour wheel */
        const d = ((targetHue - hue + 540) % 360) - 180;
        hue = Math.abs(d) < 0.1 ? targetHue : hue + d * 0.06;
        hue = (hue + 360) % 360;
        const shown = Math.round(hue * 10) / 10;
        if (shown !== lastHueShown) { root.style.setProperty("--h", shown); lastHueShown = shown; }

        sampleLevels(t);
        drawBars();
        drawParticles();
        el.glow.style.transform = "scale(" + (1 + energy * 0.3).toFixed(3) + ")";

        if (isPlaying()) updateSeek();
    }

    /* =====================================================
       INIT
    ===================================================== */
    setTheme(store.get("theme", "dark"));
    el.speed.value = String(speed);
    if (![...el.speed.options].some((o) => +o.value === speed)) { speed = 1; el.speed.value = "1"; }
    el.play.innerHTML = ICON_PLAY;
    applyVolume();
    updateModeUI();
    resize();

    tracks.forEach(preloadDuration);

    const last = store.get("last", null);
    const startIndex = last ? tracks.findIndex((t) => t.id === last.id) : -1;
    if (startIndex > -1) {
        loadTrack(startIndex, { autoplay: false, time: last.time });
        hue = targetHue;   // no colour animation on first paint
    } else if (tracks.length) {
        loadTrack(0, { autoplay: false });
        hue = targetHue;
    }

    updateFavUI();
    requestAnimationFrame(frame);
})();
