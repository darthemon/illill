(() => {
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  const todayObj = new Date();
  const todayDash = fmtDash(todayObj);

  let delayMs = 1200;
  let isBusy = false;
  let stopRequested = false;

  let mode = 'single'; // 'single' | 'range'
  let settingsOpen = false;
  let isConnected = false;
  let checkedSet = new Set();

  let viewYear = todayObj.getFullYear();
  let viewMonth = todayObj.getMonth();
  let selectedDate = todayDash;
  let rangeStart = todayDash;
  let rangeEnd = todayDash;
  let rangePickingEnd = false;
  let activePreset = null;

  function fmtDash(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtRaw(dash) {
    return String(dash || '').replace(/[^0-9]/g, '').slice(0, 8);
  }

  function rawToDash(raw) {
    const s = String(raw || '').replace(/[^0-9]/g, '').slice(0, 8);
    if (s.length !== 8) return '';
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  function parseDash(dash) {
    const [y, m, d] = String(dash).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtKoreanDate(dash) {
    const d = parseDash(dash);
    return `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())} (${WEEKDAYS[d.getDay()]})`;
  }

  function fmtShortKoreanDate(dash) {
    const d = parseDash(dash);
    return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WEEKDAYS[d.getDay()]})`;
  }

  function nowTime() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function syncBannerVisibility() {
    const banner = $('not-connected-banner');
    if (banner) {
      banner.classList.toggle('hidden', isConnected || settingsOpen);
    }
  }

  function addLog(type, badgeText, msg) {
    const list = $('log-list');
    const empty = list.querySelector('.log-empty');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      `<span class="log-time tabular">${nowTime()}</span>` +
      `<span class="log-badge ${type}">${badgeText}</span>` +
      `<span class="log-msg"></span>`;
    const msgEl = row.querySelector('.log-msg');
    msgEl.textContent = msg;
    msgEl.title = msg;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;

    const count = list.querySelectorAll('.log-row').length;
    $('log-count').textContent = String(count);
    $('log-latest').textContent = `[${badgeText}] ${msg}`;
    $('log-latest-dot').className = `log-dot ${type}`;
  }

  function setBusy(busy, isRange = false) {
    isBusy = busy;
    const disableIds = [
      'cal-prev-month', 'cal-next-month', 'btn-today',
      'btn-prev', 'btn-next', 'btn-check', 'btn-cancel', 'btn-move',
      'btn-range-check', 'btn-range-cancel', 'refresh-btn', 'banner-refresh-btn',
      'preset-3d', 'preset-7d', 'preset-week', 'preset-month',
      'tab-single', 'tab-range', 'btn-settings-toggle'
    ];
    disableIds.forEach((id) => {
      const el = $(id);
      if (el) el.disabled = busy;
    });
    document.querySelectorAll('.cal-day').forEach((el) => {
      el.disabled = busy;
    });
    $('btn-stop').classList.toggle('hidden', !(busy && isRange));
    $('progress-wrap').classList.toggle('hidden', !(busy && isRange));
  }

  // ---- Chrome Tab & Nexacro Execution ----
  async function getActiveTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0] || !tabs[0].id) throw new Error('활성 탭을 찾을 수 없습니다.');
    return tabs[0].id;
  }

  // Run a function in MAIN world across all frames and return the Nexacro frame result
  async function execInPortal(func, args = []) {
    const tabId = await getActiveTabId();
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func,
      args,
    });
    const hit = (results || []).find((r) => r && r.result && r.result.found);
    if (!hit) {
      return { found: false };
    }
    return hit.result;
  }

  // ---- Functions injected into MAIN world ----
  function portalInspectFn() {
    try {
      const wf = window.nexacro && window.nexacro.Application && window.nexacro.Application.mainframe
        && window.nexacro.Application.mainframe.VFrameSet
        && window.nexacro.Application.mainframe.VFrameSet.HFrameSet
        && window.nexacro.Application.mainframe.VFrameSet.HFrameSet.ModuleFrameSet
        && window.nexacro.Application.mainframe.VFrameSet.HFrameSet.ModuleFrameSet.WorkFrame;
      if (!wf) return { found: false };

      const winKey = Object.keys(wf).find((k) =>
        k.startsWith('win') && wf[k]?.form?.div_Work?.form?.div_resize?.form?.cal_chkDe
      );
      if (!winKey) return { found: false };

      const work = wf[winKey].form.div_Work.form;
      const resize = work.div_resize.form;
      const calVal = String(resize.cal_chkDe.value || '').replace(/[^0-9]/g, '').slice(0, 8);
      const ds = work.ds_list;
      const rowCount = ds ? ds.rowcount : 0;
      let checkedCurrent = false;
      const seen = new Set();
      const checkedDates = [];
      if (ds) {
        for (let i = 0; i < ds.rowcount; i++) {
          const rd = String(ds.getColumn(i, 'ckdate') || '').replace(/[^0-9]/g, '').slice(0, 8);
          if (rd.length === 8 && !seen.has(rd)) {
            seen.add(rd);
            checkedDates.push(rd);
          }
          if (calVal.length === 8 && rd === calVal) {
            checkedCurrent = true;
          }
        }
      }
      return { found: true, calVal, rowCount, checkedCurrent, checkedDates };
    } catch (e) {
      return { found: false, error: e.message };
    }
  }

  function portalMoveFn(dateRaw) {
    try {
      const wf = window.nexacro?.Application?.mainframe?.VFrameSet?.HFrameSet?.ModuleFrameSet?.WorkFrame;
      if (!wf) return { found: false };
      const winKey = Object.keys(wf).find((k) =>
        k.startsWith('win') && wf[k]?.form?.div_Work?.form?.div_resize?.form?.cal_chkDe
      );
      if (!winKey) return { found: false };

      const work = wf[winKey].form.div_Work.form;
      const resize = work.div_resize.form;
      resize.cal_chkDe.set_value(dateRaw);

      const ds = work.ds_list;
      let checkedCurrent = false;
      const seen = new Set();
      const checkedDates = [];
      if (ds) {
        for (let i = 0; i < ds.rowcount; i++) {
          const rd = String(ds.getColumn(i, 'ckdate') || '').replace(/[^0-9]/g, '').slice(0, 8);
          if (rd.length === 8 && !seen.has(rd)) {
            seen.add(rd);
            checkedDates.push(rd);
          }
          if (rd === dateRaw) {
            checkedCurrent = true;
          }
        }
      }
      return { found: true, ok: true, calVal: dateRaw, rowCount: ds ? ds.rowcount : 0, checkedCurrent, checkedDates };
    } catch (e) {
      return { found: true, ok: false, error: e.message };
    }
  }

  async function portalCheckOneFn(dateRaw, waitMs) {
    try {
      const wf = window.nexacro?.Application?.mainframe?.VFrameSet?.HFrameSet?.ModuleFrameSet?.WorkFrame;
      if (!wf) return { found: false };
      const winKey = Object.keys(wf).find((k) =>
        k.startsWith('win') && wf[k]?.form?.div_Work?.form?.div_resize?.form?.cal_chkDe
      );
      if (!winKey) return { found: false };

      const work = wf[winKey].form.div_Work.form;
      const resize = work.div_resize.form;
      resize.cal_chkDe.set_value(dateRaw);
      resize.cbx_chk.set_value('1');

      const logs = [];
      const ownC = Object.prototype.hasOwnProperty.call(work, 'gfn_confirmMsg');
      const ownA = Object.prototype.hasOwnProperty.call(work, 'gfn_alertMsg');
      const origC = work.gfn_confirmMsg;
      const origA = work.gfn_alertMsg;

      work.gfn_confirmMsg = function (msg, cb) {
        logs.push(msg);
        if (typeof cb === 'function') cb.call(this);
      };
      work.gfn_alertMsg = function (msg, cb) {
        logs.push(msg);
        if (typeof cb === 'function') cb.call(this);
      };

      try {
        work.fn_save();
        await new Promise((r) => setTimeout(r, waitMs));
      } finally {
        if (ownC) work.gfn_confirmMsg = origC; else delete work.gfn_confirmMsg;
        if (ownA) work.gfn_alertMsg = origA; else delete work.gfn_alertMsg;
      }

      const ds = work.ds_list;
      let checkedCurrent = false;
      const seen = new Set();
      const checkedDates = [];
      if (ds) {
        for (let i = 0; i < ds.rowcount; i++) {
          const rd = String(ds.getColumn(i, 'ckdate') || '').replace(/[^0-9]/g, '').slice(0, 8);
          if (rd.length === 8 && !seen.has(rd)) {
            seen.add(rd);
            checkedDates.push(rd);
          }
          if (rd === dateRaw) {
            checkedCurrent = true;
          }
        }
      }
      return { found: true, ok: true, calVal: dateRaw, logs, rowCount: ds ? ds.rowcount : 0, checkedCurrent, checkedDates };
    } catch (e) {
      return { found: true, ok: false, error: e.message };
    }
  }

  async function portalCancelOneFn(dateRaw, waitMs) {
    try {
      const wf = window.nexacro?.Application?.mainframe?.VFrameSet?.HFrameSet?.ModuleFrameSet?.WorkFrame;
      if (!wf) return { found: false };
      const winKey = Object.keys(wf).find((k) =>
        k.startsWith('win') && wf[k]?.form?.div_Work?.form?.div_resize?.form?.cal_chkDe
      );
      if (!winKey) return { found: false };

      const work = wf[winKey].form.div_Work.form;
      const resize = work.div_resize.form;
      resize.cal_chkDe.set_value(dateRaw);

      const ds = work.ds_list;
      let rowIdx = -1;
      const seenBefore = new Set();
      const checkedDatesBefore = [];
      if (ds) {
        for (let i = 0; i < ds.rowcount; i++) {
          const rd = String(ds.getColumn(i, 'ckdate') || '').replace(/[^0-9]/g, '').slice(0, 8);
          if (rd.length === 8 && !seenBefore.has(rd)) {
            seenBefore.add(rd);
            checkedDatesBefore.push(rd);
          }
          if (rowIdx === -1 && rd === dateRaw) {
            rowIdx = i;
          }
        }
      }

      if (rowIdx === -1) {
        return {
          found: true,
          ok: false,
          notFound: true,
          calVal: dateRaw,
          rowCount: ds ? ds.rowcount : 0,
          checkedCurrent: false,
          checkedDates: checkedDatesBefore,
        };
      }

      ds.set_rowposition(rowIdx);

      const logs = [];
      const ownC = Object.prototype.hasOwnProperty.call(work, 'gfn_confirmMsg');
      const ownA = Object.prototype.hasOwnProperty.call(work, 'gfn_alertMsg');
      const origC = work.gfn_confirmMsg;
      const origA = work.gfn_alertMsg;

      work.gfn_confirmMsg = function (msg, cb) {
        logs.push(msg);
        if (typeof cb === 'function') cb.call(this);
      };
      work.gfn_alertMsg = function (msg, cb) {
        logs.push(msg);
        if (typeof cb === 'function') cb.call(this);
      };

      try {
        work.fn_delete();
        await new Promise((r) => setTimeout(r, waitMs));
      } finally {
        if (ownC) work.gfn_confirmMsg = origC; else delete work.gfn_confirmMsg;
        if (ownA) work.gfn_alertMsg = origA; else delete work.gfn_alertMsg;
      }

      const seenAfter = new Set();
      const checkedDates = [];
      if (ds) {
        for (let i = 0; i < ds.rowcount; i++) {
          const rd = String(ds.getColumn(i, 'ckdate') || '').replace(/[^0-9]/g, '').slice(0, 8);
          if (rd.length === 8 && !seenAfter.has(rd)) {
            seenAfter.add(rd);
            checkedDates.push(rd);
          }
        }
      }

      return {
        found: true,
        ok: true,
        calVal: dateRaw,
        logs,
        rowCount: ds ? ds.rowcount : 0,
        checkedCurrent: false,
        checkedDates,
      };
    } catch (e) {
      return { found: true, ok: false, error: e.message };
    }
  }

  // ---- Calendar & View Rendering ----
  function renderCalendar() {
    $('cal-month-label').textContent = `${viewYear}년 ${viewMonth + 1}월`;

    const monthPrefix = `${viewYear}-${pad(viewMonth + 1)}-`;
    const checkedHint = $('cal-month-checked');
    if (isConnected) {
      let monthCount = 0;
      checkedSet.forEach((d) => {
        if (d.startsWith(monthPrefix)) monthCount++;
      });
      checkedHint.textContent = `이달 ${monthCount}일 체크됨`;
      checkedHint.classList.remove('hidden');
    } else {
      checkedHint.classList.add('hidden');
    }

    const firstDay = new Date(viewYear, viewMonth, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const totalCells = startOffset + daysInMonth > 35 ? 42 : 35;

    const grid = $('cal-grid');
    grid.innerHTML = '';

    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(viewYear, viewMonth, 1 - startOffset + i);
      const dash = fmtDash(cellDate);
      const isOutside = cellDate.getMonth() !== viewMonth;
      const dow = cellDate.getDay();

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.dataset.date = dash;
      btn.disabled = isBusy;
      btn.setAttribute('aria-label', fmtKoreanDate(dash));

      if (isOutside) btn.classList.add('is-outside');
      if (dow === 0) btn.classList.add('is-sun');
      if (dow === 6) btn.classList.add('is-sat');
      if (dash === todayDash) btn.classList.add('is-today');

      if (mode === 'single') {
        if (dash === selectedDate) {
          btn.classList.add('is-selected');
          btn.setAttribute('aria-selected', 'true');
        }
      } else {
        if (dash === rangeStart) btn.classList.add('is-range-start');
        if (dash === rangeEnd) btn.classList.add('is-range-end');
        if (dash > rangeStart && dash < rangeEnd) btn.classList.add('is-in-range');
        if (dash >= rangeStart && dash <= rangeEnd) {
          btn.setAttribute('aria-selected', 'true');
        }
      }

      const numSpan = document.createElement('span');
      numSpan.className = 'cal-num';
      numSpan.textContent = String(cellDate.getDate());
      btn.appendChild(numSpan);

      if (isConnected && checkedSet.has(dash)) {
        btn.classList.add('has-check');
        const dot = document.createElement('span');
        dot.className = 'cal-dot';
        btn.appendChild(dot);
      }

      btn.addEventListener('click', () => handleDayClick(dash, isOutside));
      grid.appendChild(btn);
    }
  }

  function renderSingleCard() {
    $('single-date-display').textContent = fmtKoreanDate(selectedDate);
    $('single-today-chip').classList.toggle('hidden', selectedDate !== todayDash);

    const statusEl = $('portal-status');
    if (!isConnected) {
      statusEl.textContent = '포털 미연결';
      statusEl.className = 'state-badge';
    } else if (checkedSet.has(selectedDate)) {
      statusEl.textContent = '체크 완료';
      statusEl.className = 'state-badge is-checked';
    } else {
      statusEl.textContent = '미체크';
      statusEl.className = 'state-badge is-unchecked';
    }
  }

  function renderRangeCard() {
    const diff = Math.floor((parseDash(rangeEnd) - parseDash(rangeStart)) / 86400000) + 1;

    if (rangeStart === rangeEnd) {
      $('range-dates-display').textContent = fmtKoreanDate(rangeStart);
    } else {
      $('range-dates-display').textContent = `${fmtShortKoreanDate(rangeStart)} — ${fmtShortKoreanDate(rangeEnd)}`;
    }
    $('range-days-badge').textContent = `${diff}일`;
    $('btn-range-check-label').textContent = `${diff}일 일괄 체크`;

    const hintEl = $('range-hint');
    if (rangePickingEnd) {
      hintEl.textContent = '종료일을 한 번 더 클릭하세요';
      hintEl.classList.add('is-picking');
    } else {
      hintEl.classList.remove('is-picking');
      if (isConnected) {
        let uncheckedCount = 0;
        const cur = parseDash(rangeStart);
        const end = parseDash(rangeEnd);
        while (cur <= end) {
          if (!checkedSet.has(fmtDash(cur))) uncheckedCount++;
          cur.setDate(cur.getDate() + 1);
        }
        hintEl.textContent = uncheckedCount === 0
          ? '선택한 기간이 모두 체크되어 있어요'
          : `미체크 ${uncheckedCount}일 포함`;
      } else {
        hintEl.textContent = '달력에서 시작일과 종료일을 클릭하세요';
      }
    }

    const presetMap = {
      '3d': 'preset-3d',
      '7d': 'preset-7d',
      'week': 'preset-week',
      'month': 'preset-month',
    };
    Object.entries(presetMap).forEach(([key, id]) => {
      $(id).classList.toggle('is-active', activePreset === key);
    });
  }

  function renderAll() {
    renderCalendar();
    renderSingleCard();
    renderRangeCard();
  }

  function handleDayClick(dash, isOutside) {
    if (isBusy) return;
    if (isOutside) {
      const d = parseDash(dash);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
    }

    if (mode === 'single') {
      selectedDate = dash;
    } else {
      activePreset = null;
      if (!rangePickingEnd) {
        rangeStart = dash;
        rangeEnd = dash;
        rangePickingEnd = true;
      } else {
        if (dash < rangeStart) {
          rangeEnd = rangeStart;
          rangeStart = dash;
        } else {
          rangeEnd = dash;
        }
        rangePickingEnd = false;
      }
    }
    renderAll();
  }

  function renderPortalSummary(res, syncInput = false) {
    const badge = $('conn-badge');
    const connText = $('conn-text');

    if (!res || !res.found) {
      isConnected = false;
      checkedSet = new Set();
      badge.className = 'conn-pill status-warn';
      connText.textContent = '미감지';
      $('portal-date').textContent = '-';
      $('portal-count').textContent = '-';
      syncBannerVisibility();
      renderAll();
      return;
    }

    isConnected = true;
    badge.className = 'conn-pill status-ok';
    connText.textContent = '연결됨';

    const nextSet = new Set();
    if (Array.isArray(res.checkedDates)) {
      res.checkedDates.forEach((raw) => {
        const d = rawToDash(raw);
        if (d) nextSet.add(d);
      });
    }
    checkedSet = nextSet;

    const dash = rawToDash(res.calVal);
    $('portal-date').textContent = dash || '-';
    $('portal-count').textContent = `${res.rowCount}건`;

    if (syncInput && dash) {
      selectedDate = dash;
      const d = parseDash(dash);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
    }

    syncBannerVisibility();
    renderAll();
  }

  async function refreshConnection(syncInput = false) {
    const btn = $('refresh-btn');
    const startedAt = Date.now();
    if (btn) btn.classList.add('is-spinning');
    try {
      const res = await execInPortal(portalInspectFn);
      renderPortalSummary(res, syncInput);
    } catch (err) {
      renderPortalSummary({ found: false });
    } finally {
      if (btn) {
        const elapsed = Date.now() - startedAt;
        const remain = Math.max(0, 350 - elapsed);
        setTimeout(() => btn.classList.remove('is-spinning'), remain);
      }
    }
  }

  // ---- Mode & Settings Switching ----
  function switchMode(nextMode) {
    if (isBusy) return;
    mode = nextMode;
    rangePickingEnd = false;
    $('tab-single').classList.toggle('active', mode === 'single');
    $('tab-single').setAttribute('aria-selected', String(mode === 'single'));
    $('tab-range').classList.toggle('active', mode === 'range');
    $('tab-range').setAttribute('aria-selected', String(mode === 'range'));
    $('panel-single').classList.toggle('hidden', mode !== 'single');
    $('panel-range').classList.toggle('hidden', mode !== 'range');
    renderAll();
  }

  function setSettingsOpen(open) {
    if (isBusy) return;
    settingsOpen = open;
    $('workspace-view').classList.toggle('hidden', open);
    $('panel-settings').classList.toggle('hidden', !open);
    $('btn-settings-toggle').classList.toggle('is-active', open);
    $('btn-settings-toggle').setAttribute('aria-pressed', String(open));
    syncBannerVisibility();
  }

  $('tab-single').addEventListener('click', () => switchMode('single'));
  $('tab-range').addEventListener('click', () => switchMode('range'));
  $('btn-settings-toggle').addEventListener('click', () => setSettingsOpen(!settingsOpen));
  $('btn-settings-back').addEventListener('click', () => setSettingsOpen(false));

  // ---- Calendar Navigation ----
  $('cal-prev-month').addEventListener('click', () => {
    if (isBusy) return;
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderCalendar();
  });

  $('cal-next-month').addEventListener('click', () => {
    if (isBusy) return;
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderCalendar();
  });

  $('btn-today').addEventListener('click', () => {
    if (isBusy) return;
    const now = new Date();
    const nowDash = fmtDash(now);
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    if (mode === 'single') {
      moveToDate(nowDash);
    } else {
      activePreset = null;
      rangePickingEnd = false;
      rangeStart = nowDash;
      rangeEnd = nowDash;
      renderAll();
    }
  });

  // ---- Single Date Actions ----
  async function moveToDate(dash) {
    if (!dash) return;
    selectedDate = dash;
    const d = parseDash(dash);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    renderAll();

    try {
      const res = await execInPortal(portalMoveFn, [fmtRaw(dash)]);
      renderPortalSummary(res);
      if (!res.found) {
        addLog('err', '실패', '일일체크 화면을 먼저 열어주세요.');
      } else if (res.ok) {
        addLog('info', '이동', `${dash} 날짜로 이동`);
      } else {
        addLog('err', '오류', res.error || '이동 실패');
      }
    } catch (err) {
      addLog('err', '오류', err.message);
    }
  }

  function shiftSingle(days) {
    if (isBusy) return;
    const base = parseDash(selectedDate);
    base.setDate(base.getDate() + days);
    moveToDate(fmtDash(base));
  }

  $('btn-prev').addEventListener('click', () => shiftSingle(-1));
  $('btn-next').addEventListener('click', () => shiftSingle(1));
  $('btn-move').addEventListener('click', () => moveToDate(selectedDate));

  $('btn-check').addEventListener('click', async () => {
    if (isBusy) return;
    const dash = selectedDate;
    const labelEl = $('btn-check').querySelector('.btn-label');
    const prevLabel = labelEl ? labelEl.textContent : '';
    if (labelEl) labelEl.textContent = '처리 중...';
    setBusy(true, false);
    try {
      const res = await execInPortal(portalCheckOneFn, [fmtRaw(dash), delayMs]);
      renderPortalSummary(res);
      if (!res.found) addLog('err', '실패', '일일체크 화면을 먼저 열어주세요.');
      else if (res.ok) addLog('ok', '완료', `${dash} 일일체크 완료`);
      else addLog('err', '오류', res.error || '체크 실패');
    } catch (err) {
      addLog('err', '오류', err.message);
    } finally {
      if (labelEl) labelEl.textContent = prevLabel;
      setBusy(false, false);
      renderCalendar();
    }
  });

  $('btn-cancel').addEventListener('click', async () => {
    if (isBusy) return;
    const dash = selectedDate;
    const btnCancel = $('btn-cancel');
    const prevText = btnCancel.textContent;
    btnCancel.textContent = '취소 중...';
    setBusy(true, false);
    try {
      const res = await execInPortal(portalCancelOneFn, [fmtRaw(dash), delayMs]);
      renderPortalSummary(res);
      if (!res.found) addLog('err', '실패', '일일체크 화면을 먼저 열어주세요.');
      else if (res.ok) addLog('warn', '취소', `${dash} 체크 취소 완료`);
      else if (res.notFound) addLog('warn', '없음', `${dash} 체크 기록이 없습니다.`);
      else addLog('err', '오류', res.error || '취소 실패');
    } catch (err) {
      addLog('err', '오류', err.message);
    } finally {
      btnCancel.textContent = prevText;
      setBusy(false, false);
      renderCalendar();
    }
  });

  // ---- Range Actions ----
  function applyRangePreset(preset) {
    if (isBusy) return;
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (preset === '3d') {
      start.setDate(start.getDate() - 2);
    } else if (preset === '7d') {
      start.setDate(start.getDate() - 6);
    } else if (preset === 'week') {
      const day = start.getDay();
      const diffToMon = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diffToMon);
    } else if (preset === 'month') {
      start.setDate(1);
    }
    rangeStart = fmtDash(start);
    rangeEnd = fmtDash(end);
    rangePickingEnd = false;
    activePreset = preset;
    viewYear = end.getFullYear();
    viewMonth = end.getMonth();
    renderAll();
  }

  $('preset-3d').addEventListener('click', () => applyRangePreset('3d'));
  $('preset-7d').addEventListener('click', () => applyRangePreset('7d'));
  $('preset-week').addEventListener('click', () => applyRangePreset('week'));
  $('preset-month').addEventListener('click', () => applyRangePreset('month'));

  async function runRange(op) {
    if (isBusy) return;
    const cur = parseDash(rangeStart);
    const end = parseDash(rangeEnd);
    const total = Math.floor((end - cur) / 86400000) + 1;
    if (total <= 0) {
      addLog('err', '오류', '올바른 기간을 선택해 주세요.');
      return;
    }

    stopRequested = false;
    setBusy(true, true);

    let done = 0;
    const updateProgress = () => {
      const pct = Math.round((done / total) * 100);
      $('progress-label').textContent = `${op === 'check' ? '일괄 체크' : '일괄 취소'} (${done}/${total})`;
      $('progress-pct').textContent = `${pct}%`;
      $('progress-bar').style.width = `${pct}%`;
    };
    updateProgress();

    try {
      while (cur <= end) {
        if (stopRequested) {
          addLog('warn', '중지', `사용자 요청으로 중지됨 (${done}/${total})`);
          break;
        }
        const dash = fmtDash(cur);
        const raw = fmtRaw(dash);
        const res = op === 'check'
          ? await execInPortal(portalCheckOneFn, [raw, delayMs])
          : await execInPortal(portalCancelOneFn, [raw, delayMs]);

        renderPortalSummary(res);
        if (!res.found) {
          addLog('err', '실패', '일일체크 화면을 찾지 못해 작업을 중단했습니다.');
          break;
        }
        if (op === 'check') {
          if (res.ok) addLog('ok', '체크', `${dash} 완료`);
          else addLog('err', '오류', `${dash} ${res.error || '실패'}`);
        } else {
          if (res.ok) addLog('warn', '취소', `${dash} 삭제 완료`);
          else if (res.notFound) addLog('info', '건너뜀', `${dash} 기록 없음`);
          else addLog('err', '오류', `${dash} ${res.error || '실패'}`);
        }

        done++;
        updateProgress();
        cur.setDate(cur.getDate() + 1);
      }

      if (!stopRequested && done === total) {
        addLog('ok', '종료', `기간 작업 완료 (${total}일)`);
      }
    } catch (err) {
      addLog('err', '오류', err.message);
    } finally {
      setBusy(false, false);
      renderCalendar();
    }
  }

  $('btn-range-check').addEventListener('click', () => runRange('check'));
  $('btn-range-cancel').addEventListener('click', () => runRange('cancel'));
  $('btn-stop').addEventListener('click', () => { stopRequested = true; });

  // ---- Settings & Speed Pills ----
  function syncSpeedPills() {
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      const val = Number(btn.dataset.delay);
      btn.classList.toggle('is-selected', val === delayMs);
    });
  }

  document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.delay) || 1200;
      delayMs = next;
      syncSpeedPills();
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ delayMs });
        }
      } catch (_) {}
      addLog('info', '설정', `대기 시간 ${(delayMs / 1000).toFixed(1)}초로 변경`);
    });
  });

  // ---- Refresh & Log Drawer ----
  $('refresh-btn').addEventListener('click', () => refreshConnection(true));
  $('banner-refresh-btn').addEventListener('click', () => refreshConnection(true));

  $('log-toggle-btn').addEventListener('click', () => {
    const bar = $('log-toggle-btn');
    const drawer = $('log-drawer');
    const willOpen = drawer.classList.contains('hidden');
    drawer.classList.toggle('hidden', !willOpen);
    bar.classList.toggle('is-open', willOpen);
    bar.setAttribute('aria-expanded', String(willOpen));
  });

  $('clear-log-btn').addEventListener('click', () => {
    $('log-list').innerHTML = '<div class="log-empty">아직 실행한 작업이 없습니다.</div>';
    $('log-count').textContent = '0';
    $('log-latest').textContent = '준비됨 · 달력에서 날짜를 선택하세요';
    $('log-latest-dot').className = 'log-dot';
  });

  // ---- Init ----
  syncSpeedPills();
  renderAll();

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['delayMs'], (data) => {
        if (data && data.delayMs) {
          delayMs = Number(data.delayMs);
          syncSpeedPills();
        }
      });
    }
  } catch (_) {}

  refreshConnection(true);
})();
