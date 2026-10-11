(function() {
  function getParam(key) {
    try {
      var qs = window.location.search || '';
      var match = qs.match(new RegExp('[?&]' + key + '=([^&#]*)'));
      if (match && match[1]) {
        return decodeURIComponent(match[1].replace(/\+/g, ' '));
      }
    } catch (e) {
      console.warn('URL param parse exception:', e);
    }
    return '';
  }

  var eventId = getParam('id') || getParam('event_id');
  var paramCam = getParam('cam') || getParam('camera');
  var paramLabel = getParam('label');
  var paramScore = getParam('score');
  var paramTime = getParam('time');
  var paramLoc = getParam('loc') || getParam('location');

  var video = document.getElementById('mainVideo');
  var loader = document.getElementById('videoLoader');
  var txtMain = document.getElementById('txtLoadingMain');
  var txtSub = document.getElementById('txtLoadingSub');
  var btnDownload = document.getElementById('btnDownloadVideo');
  var imgSnapshot = document.getElementById('imgSnapshot');
  var btnFallback = document.getElementById('btnFallbackPlay');
  var btnUnmute = document.getElementById('btnUnmute');

  // Unmute button click handler
  if (btnUnmute) {
    btnUnmute.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (video) {
        video.muted = false;
        btnUnmute.style.display = 'none';
      }
    });
  }

  // 1. Immediately populate metadata from URL parameters
  if (paramCam) {
    var txtCamBadge = document.getElementById('txtCamBadge');
    var valCamera = document.getElementById('valCamera');
    if (txtCamBadge) txtCamBadge.innerText = paramCam;
    if (valCamera) valCamera.innerText = paramCam;
  }
  if (paramLabel) {
    var valLabel = document.getElementById('valLabel');
    if (valLabel) valLabel.innerText = paramLabel;
  }
  if (paramScore) {
    var valScore = document.getElementById('valScore');
    if (valScore) valScore.innerText = paramScore.indexOf('%') !== -1 ? paramScore : (paramScore + '%');
  }
  if (paramTime) {
    var valTime = document.getElementById('valTime');
    if (valTime) valTime.innerText = paramTime;
  }
  if (paramLoc && paramLoc.trim() !== '') {
    var valLocation = document.getElementById('valLocation');
    var rowLocation = document.getElementById('rowLocation');
    if (valLocation) valLocation.innerText = paramLoc;
    if (rowLocation) rowLocation.style.display = 'flex';
  }
  var valEventId = document.getElementById('valEventId');
  if (valEventId) valEventId.innerText = eventId || 'N/A';

  // 2. Attach instant HD snapshot image
  if (eventId && imgSnapshot) {
    var snapUrl = '/nvr/api/events/' + encodeURIComponent(eventId) + '/snapshot.jpg';
    imgSnapshot.src = snapUrl;
    imgSnapshot.onerror = function() {
      if (paramCam) {
        this.src = '/nvr/api/' + encodeURIComponent(paramCam) + '/latest.jpg';
      }
    };
    if (video) video.poster = snapUrl;
  }

  // Video event listeners
  if (video) {
    video.addEventListener('loadeddata', function() { if (loader) loader.style.display = 'none'; });
    video.addEventListener('canplay', function() { if (loader) loader.style.display = 'none'; });
    video.addEventListener('playing', function() {
      if (loader) loader.style.display = 'none';
      if (video.muted && btnUnmute) {
        btnUnmute.style.display = 'flex';
      }
    });
    video.addEventListener('volumechange', function() {
      if (!video.muted && btnUnmute) {
        btnUnmute.style.display = 'none';
      }
    });
    video.addEventListener('waiting', function() {
      if (txtMain) txtMain.innerText = 'กำลังโหลดข้อมูลวิดีโอ (เน็ตอาจช้า)...';
      if (loader) loader.style.display = 'flex';
    });
    video.addEventListener('error', function() {
      console.warn('Video playback error:', video.error);
      if (txtMain) txtMain.innerText = 'กำลังเชื่อมต่อสตรีมสำรอง...';
      if (btnFallback) btnFallback.style.display = 'block';
    });
  }

  function formatThaiDate(unixTs) {
    if (!unixTs) return '';
    var d = new Date(unixTs * 1000);
    var months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var day = d.getDate();
    var month = months[d.getMonth()];
    var year = d.getFullYear() + 543;
    var hours = String(d.getHours()).padStart(2, '0');
    var mins = String(d.getMinutes()).padStart(2, '0');
    var secs = String(d.getSeconds()).padStart(2, '0');
    return day + ' ' + month + ' ' + year + ' เวลา ' + hours + ':' + mins + ':' + secs + ' น.';
  }

  // Fetch metadata from NVR API
  async function syncNVRDetails() {
    if (!eventId) return;
    try {
      var res = await fetch('/nvr/api/events/' + encodeURIComponent(eventId));
      if (res.ok) {
        var ev = await res.json();
        if (ev.camera) {
          var txtCamBadge = document.getElementById('txtCamBadge');
          var valCamera = document.getElementById('valCamera');
          if (txtCamBadge) txtCamBadge.innerText = ev.camera;
          if (valCamera) valCamera.innerText = ev.camera;
        }
        if (ev.label) {
          var labelMap = {
            'person': 'บุคคล (Person)',
            'car': 'รถยนต์ (Car)',
            'motorcycle': 'รถจักรยานยนต์ (Motorcycle)',
            'truck': 'รถบรรทุก (Truck)',
            'bus': 'รถบัส (Bus)',
            'dog': 'สุนัข (Dog)',
            'cat': 'แมว (Cat)'
          };
          var valLabel = document.getElementById('valLabel');
          if (valLabel) valLabel.innerText = labelMap[ev.label] || ev.label;
        }
        if (ev.top_score) {
          var valScore = document.getElementById('valScore');
          if (valScore) valScore.innerText = (ev.top_score * 100).toFixed(1) + '%';
        }
        if (ev.start_time) {
          var valTime = document.getElementById('valTime');
          if (valTime) valTime.innerText = formatThaiDate(ev.start_time);
        }
      }
    } catch (e) {
      console.debug('NVR sync skipped:', e);
    }
  }

  function resolveUrl(u) {
    if (!u) return '';
    if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) return u;
    if (u.indexOf('/api/media-compat/') === 0) return u;
    if (u.indexOf('/media/') === 0) return '/api/media-compat' + u;
    return u.indexOf('/') === 0 ? u : ('/' + u);
  }

  function startPlayback(url) {
    if (!video) return;
    video.src = url;
    if (btnDownload) btnDownload.href = url;
    // Explicitly set muted to true before .play() to ensure iOS Safari allows autoplay
    video.muted = true;
    video.load();
    var playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(function() {
        if (loader) loader.style.display = 'none';
        if (video.muted && btnUnmute) {
          btnUnmute.style.display = 'flex';
        }
      }).catch(function(e) {
        console.warn('Playback error or policy blocked:', e);
        if (loader) loader.style.display = 'none';
      });
    }
  }

  window.playFallbackDirect = function() {
    if (btnFallback) btnFallback.style.display = 'none';
    startPlayback('/nvr/api/events/' + encodeURIComponent(eventId) + '/clip.mp4');
  };

  // Main start routine
  async function initPlayer() {
    if (!eventId) {
      if (txtMain) txtMain.innerText = 'ไม่พบรหัสเหตุการณ์ (Event ID)';
      return;
    }

    syncNVRDetails();

    setTimeout(function() {
      if (loader && loader.style.display !== 'none') {
        if (btnFallback) btnFallback.style.display = 'block';
      }
    }, 4000);

    try {
      if (txtMain) txtMain.innerText = 'กำลังเชื่อมต่อวิดีโอคลิป H.264...';
      var res = await fetch('/api/media-compat/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'playback', event_id: eventId })
      });

      if (!res.ok) throw new Error('Status ' + res.status);
      var data = await res.json();

      if (data.media_url) {
        startPlayback(resolveUrl(data.media_url));
        return;
      }

      var jobId = data.job_id;
      for (var i = 0; i < 25; i++) {
        await new Promise(function(r) { setTimeout(r, 500); });
        var pollRes = await fetch('/api/media-compat/jobs/' + encodeURIComponent(jobId));
        if (!pollRes.ok) continue;
        var pollData = await pollRes.json();
        if (pollData.state === 'ready' && pollData.media_url) {
          startPlayback(resolveUrl(pollData.media_url));
          return;
        } else if (pollData.state === 'failed') {
          throw new Error('Transcode failed');
        }
      }
      throw new Error('Timeout');
    } catch (err) {
      console.warn('Fallback to direct stream:', err);
      startPlayback('/nvr/api/events/' + encodeURIComponent(eventId) + '/clip.mp4');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlayer);
  } else {
    initPlayer();
  }
})();
