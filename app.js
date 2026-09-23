(() => {
  const C = window.YL_CONFIG;
  const $ = (id) => document.getElementById(id);
  const store = {
    get() { try { return localStorage.getItem("yl_session") || sessionStorage.getItem("yl_session"); } catch (e) { return null; } },
    clear() { try { localStorage.removeItem("yl_session"); sessionStorage.removeItem("yl_session"); } catch (e) {} },
  };
  const PRIVACY_LABELS = {
    PUBLIC_TO_EVERYONE: "Everyone",
    MUTUAL_FOLLOW_FRIENDS: "Friends (followers you follow back)",
    FOLLOWER_OF_CREATOR: "Followers",
    SELF_ONLY: "Only me",
  };
  const MUSIC = '<a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>';
  const BC = '<a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Branded Content Policy</a>';

  let session = store.get();
  let creator = null;
  let video = null; // {path, queue_id?, duration?}
  let busy = false;

  async function api(action, extra = {}) {
    const r = await fetch(C.api, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: C.anonKey },
      body: JSON.stringify({ action, session, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || `HTTP ${r.status}`);
      err.status = r.status; err.detail = j.detail;
      throw err;
    }
    return j;
  }

  function show(id) {
    for (const s of ["connect", "studio", "loading"]) $(s).classList.toggle("hidden", s !== id);
  }

  function notice(el, text, kind) {
    el.className = "notice" + (kind ? " " + kind : "");
    el.innerHTML = text;
    el.classList.remove("hidden");
  }

  // ---------- connect ----------
  $("btnConnect").onclick = async () => {
    $("btnConnect").disabled = true;
    try {
      const { url } = await api("auth_url");
      location.href = url;
    } catch (e) {
      $("connectMsg").textContent = "Couldn't start sign-in: " + e.message;
      $("btnConnect").disabled = false;
    }
  };

  $("btnLogout").onclick = async () => {
    try { await api("logout"); } catch (e) {}
    store.clear(); session = null; creator = null;
    show("connect");
  };

  // ---------- creator info ----------
  async function loadCreator() {
    creator = await api("creator_info");
    $("avatar").src = creator.creator_avatar_url || "";
    $("nickname").textContent = creator.creator_nickname || "";
    $("username").textContent = creator.creator_username ? "@" + creator.creator_username : "";

    const sel = $("privacy");
    sel.innerHTML = '<option value="" selected disabled>Select privacy</option>';
    for (const opt of creator.privacy_level_options || []) {
      const o = document.createElement("option");
      o.value = opt; o.textContent = PRIVACY_LABELS[opt] || opt;
      sel.appendChild(o);
    }
    const setDis = (id, dis) => { $(id).checked = false; $(id).disabled = !!dis; };
    setDis("allowComment", creator.comment_disabled);
    setDis("allowDuet", creator.duet_disabled);
    setDis("allowStitch", creator.stitch_disabled);
    const off = [];
    if (creator.comment_disabled) off.push("Comments");
    if (creator.duet_disabled) off.push("Duet");
    if (creator.stitch_disabled) off.push("Stitch");
    $("interactionHint").textContent = off.length ? `${off.join(", ")} turned off in your TikTok privacy settings.` : "";
  }

  // ---------- queue ----------
  async function loadQueue() {
    try {
      const { items } = await api("queue");
      const q = $("queue");
      q.innerHTML = "";
      $("queueWrap").classList.toggle("hidden", !items.length);
      for (const it of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.title = it.suggested_title || "Prepared video";
        b.innerHTML = `<video src="${it.public_url}#t=0.5" muted preload="metadata"></video>`;
        b.onclick = () => {
          [...q.children].forEach((c) => c.classList.remove("sel"));
          b.classList.add("sel");
          setVideo({ path: it.video_path, queue_id: it.id }, it.public_url);
          if (it.suggested_title && !$("title").value) { $("title").value = it.suggested_title; updateCount(); }
        };
        q.appendChild(b);
      }
    } catch (e) { /* queue is optional */ }
  }

  // ---------- video ----------
  function setVideo(v, url) {
    video = v;
    const p = $("preview");
    p.src = url;
    $("durationMsg").textContent = "";
    p.onloadedmetadata = () => {
      video.duration = p.duration;
      const max = creator?.max_video_post_duration_sec;
      if (max && p.duration > max) {
        $("durationMsg").textContent = `This video is ${Math.round(p.duration)}s long. Your account can post videos up to ${max}s.`;
        video.tooLong = true;
      } else {
        video.tooLong = false;
      }
      validate();
    };
    validate();
  }

  $("file").onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    $("uploadMsg").textContent = "Uploading…";
    [...$("queue").children].forEach((c) => c.classList.remove("sel"));
    video = null; validate();
    try {
      const up = await api("upload_url", { content_type: f.type || "video/mp4" });
      const r = await fetch(up.signed_url, {
        method: "PUT",
        headers: { "content-type": f.type || "video/mp4", "x-upsert": "false", apikey: C.anonKey },
        body: f,
      });
      if (!r.ok) throw new Error("upload failed (" + r.status + ")");
      $("uploadMsg").textContent = "Ready: " + f.name;
      setVideo({ path: up.path }, URL.createObjectURL(f));
    } catch (e) {
      $("uploadMsg").textContent = "Upload error: " + e.message;
    }
  };

  // ---------- form ----------
  function updateCount() { $("titleCount").textContent = $("title").value.length; }
  $("title").oninput = updateCount;

  function updateDisclosure() {
    const on = $("disclose").checked;
    $("discloseBox").classList.toggle("hidden", !on);
    if (!on) { $("yourBrand").checked = false; $("brandedContent").checked = false; }
    const yb = $("yourBrand").checked, bc = $("brandedContent").checked;

    // Branded content can't be private
    const selfOpt = [...$("privacy").options].find((o) => o.value === "SELF_ONLY");
    if (selfOpt) {
      selfOpt.disabled = bc;
      selfOpt.textContent = bc ? "Only me (not available for branded content)" : PRIVACY_LABELS.SELF_ONLY;
      if (bc && $("privacy").value === "SELF_ONLY") $("privacy").value = "";
    }
    $("privacyHint").textContent = bc ? "Branded content visibility can't be set to private." : "";

    $("discloseNeed").classList.toggle("hidden", !on || yb || bc);
    const lbl = $("discloseLabel");
    if (on && (yb || bc)) {
      notice(lbl, `Your video will be labeled as <strong>"${bc ? "Paid partnership" : "Promotional content"}"</strong>. This cannot be changed once your video is posted.`);
    } else lbl.classList.add("hidden");

    $("declaration").innerHTML = bc
      ? `By posting, you agree to TikTok's ${BC} and ${MUSIC}.`
      : `By posting, you agree to TikTok's ${MUSIC}.`;
    validate();
  }
  for (const id of ["disclose", "yourBrand", "brandedContent"]) $(id).onchange = updateDisclosure;
  $("privacy").onchange = validate;

  function validate() {
    const on = $("disclose").checked;
    const discloseOk = !on || $("yourBrand").checked || $("brandedContent").checked;
    const ok = !busy && creator && video && !video.tooLong && $("privacy").value && discloseOk;
    $("btnPublish").disabled = !ok;
    $("btnPublish").title = !$("privacy").value ? "Select who can view this video" : !discloseOk ? "Choose Your brand and/or Branded content" : "";
  }

  // ---------- publish ----------
  $("btnPublish").onclick = async () => {
    busy = true; validate();
    const msg = $("publishMsg");
    notice(msg, "Sending your video to TikTok…");
    try {
      const d = await api("publish", {
        consent: true,
        path: video.path,
        queue_id: video.queue_id,
        title: $("title").value,
        privacy_level: $("privacy").value,
        disable_comment: !$("allowComment").checked,
        disable_duet: !$("allowDuet").checked,
        disable_stitch: !$("allowStitch").checked,
        brand_organic_toggle: $("disclose").checked && $("yourBrand").checked,
        brand_content_toggle: $("disclose").checked && $("brandedContent").checked,
        is_aigc: $("aigc").checked,
      });
      notice(msg, "Posted! TikTok is processing your video. It may take a few minutes to appear on your profile.", "ok");
      pollStatus(d.publish_id, msg);
    } catch (e) {
      notice(msg, "Couldn't publish: " + e.message, "err");
      busy = false; validate();
    }
  };

  async function pollStatus(id, msg) {
    for (let i = 0, wait = 4000; i < 12; i++, wait = Math.min(wait * 1.5, 20000)) {
      await new Promise((r) => setTimeout(r, wait));
      try {
        const s = await api("status", { publish_id: id });
        if (s.status === "PUBLISH_COMPLETE") {
          notice(msg, "Done — your video is live on TikTok.", "ok");
          break;
        }
        if (s.status === "FAILED") {
          notice(msg, "TikTok couldn't publish this video: " + (s.fail_reason || "unknown reason"), "err");
          break;
        }
        notice(msg, "TikTok is processing your video (" + (s.status || "…").toLowerCase().replace(/_/g, " ") + "). It may take a few minutes to appear on your profile.", "ok");
      } catch (e) { /* keep waiting */ }
    }
    busy = false;
    video = null; $("preview").removeAttribute("src"); $("preview").load();
    $("title").value = ""; updateCount(); $("privacy").value = "";
    loadQueue(); validate();
  }

  // ---------- boot ----------
  (async () => {
    updateDisclosure();
    if (!session) return show("connect");
    try {
      await loadCreator();
      show("studio");
      loadQueue();
    } catch (e) {
      if (e.status === 401) { store.clear(); session = null; return show("connect"); }
      show("studio");
      notice($("publishMsg"), "TikTok says you can't post right now: " + e.message + ". Please try again later.", "err");
    }
  })();
})();
