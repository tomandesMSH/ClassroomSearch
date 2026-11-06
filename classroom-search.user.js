// ==UserScript==
// @name         Google Classroom Search
// @namespace    classroom-search
// @version      2.1.1
// @description  Adds a live search box to Google Classroom's class list, plus custom tags you assign yourself (with export/import) so you can filter classes by more than just their name.
// @author       tomandesMSH
// @match        https://classroom.google.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/tomandesMSH/ClassroomSearch
// @supportURL   https://github.com/tomandesMSH/ClassroomSearch/issues
// @updateURL    https://raw.githubusercontent.com/tomandesMSH/ClassroomSearch/main/classroom-search.user.js
// @downloadURL  https://raw.githubusercontent.com/tomandesMSH/ClassroomSearch/main/classroom-search.user.js
// ==/UserScript==

(function () {
  'use strict';

  const WIDGET_ID = 'cs-classroom-search-widget';
  const TAGS_KEY = 'cs-classroom-tags-v1';

  let currentQuery = '';
  let searchInputRef = null;
  let statusEl = null;

  // ---------------------------------------------------------------------
  // Card discovery
  // ---------------------------------------------------------------------

  function getCards() {
    // Google Classroom renders each class card as an <li> whose heading
    // (h1-h4) wraps an <a> linking to "/c/<courseId>". This structural
    // shape has stayed stable across Classroom UI refreshes even though
    // the obfuscated CSS class names on the cards change often, so we
    // key off it instead of any particular class name.
    const headingLinks = document.querySelectorAll(
      'h1 a[href*="/c/"], h2 a[href*="/c/"], h3 a[href*="/c/"], h4 a[href*="/c/"]'
    );
    const cards = new Set();
    headingLinks.forEach((a) => {
      const li = a.closest('li');
      if (li) cards.add(li);
    });
    return Array.from(cards);
  }

  function getCourseId(card) {
    const a = card.querySelector(
      'h1 a[href*="/c/"], h2 a[href*="/c/"], h3 a[href*="/c/"], h4 a[href*="/c/"]'
    );
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/c\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function getCourseName(card) {
    const heading = card.querySelector('h1, h2, h3, h4');
    return heading ? heading.textContent.trim() : '';
  }

  // ---------------------------------------------------------------------
  // Tag storage (per-course, kept in localStorage - private to this
  // browser profile, same as Tampermonkey's own storage would be, and
  // scoped to the classroom.google.com origin)
  // ---------------------------------------------------------------------

  function loadAllTags() {
    try {
      return JSON.parse(localStorage.getItem(TAGS_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveAllTags(all) {
    localStorage.setItem(TAGS_KEY, JSON.stringify(all));
  }

  function getTags(courseId) {
    if (!courseId) return [];
    const all = loadAllTags();
    return all[courseId] || [];
  }

  function setTags(courseId, tags) {
    if (!courseId) return;
    const all = loadAllTags();
    if (tags.length) {
      all[courseId] = tags;
    } else {
      delete all[courseId];
    }
    saveAllTags(all);
  }

  // ---------------------------------------------------------------------
  // Search / filter
  // ---------------------------------------------------------------------

  function applyFilter() {
    const cards = getCards();
    const query = currentQuery.trim().toLowerCase();
    let visibleCount = 0;

    cards.forEach((card) => {
      const courseId = getCourseId(card);
      const tags = getTags(courseId);
      const text = (card.textContent + ' ' + tags.join(' ')).toLowerCase();
      const matches = query === '' || text.includes(query);
      card.style.display = matches ? '' : 'none';
      if (matches) visibleCount += 1;
    });

    updateStatus(cards.length, visibleCount, query);
  }

  function updateStatus(total, visible, query) {
    if (!statusEl) return;
    if (!query) {
      statusEl.textContent = total ? `${total} classes` : '';
    } else {
      statusEl.textContent = `${visible} / ${total} match`;
    }
  }

  // ---------------------------------------------------------------------
  // Tag chips + "add tag" affordance on each card
  //
  // Note: this was originally meant to live as an "Add a tag" item inside
  // Classroom's own card menu (the Move/Hide/Unenroll dropdown), matching
  // how a native menu item would look. In testing, that dropdown turned
  // out to have an actively height-animated popup that Classroom sizes
  // for its own fixed 3-item content and that silently resists a 4th
  // item (even forcing styles with !important didn't stick - the
  // computed height kept snapping back). Rather than fight an internal,
  // undocumented animation that could break differently on any future
  // Classroom update, tags live in a small row on the card itself
  // instead - still one click away, and arguably more discoverable since
  // it's visible without opening a menu at all.
  // ---------------------------------------------------------------------

  function renderTagsForCard(card) {
    const courseId = getCourseId(card);
    if (!courseId) return;

    const tags = getTags(courseId);
    const tagsKey = tags.join('');
    let row = card.querySelector(':scope > .cs-tag-row');

    // Nothing changed since the last render for this card - skip touching
    // the DOM entirely. Writing to the DOM here (even identical content)
    // would retrigger the MutationObserver below that calls this
    // function, which kept re-running forever: a self-sustaining loop
    // that pegged the CPU and made Classroom's own UI - including the
    // course card's "more options" menu - feel broken/unresponsive.
    if (row && row.dataset.csTagsKey === tagsKey) return;

    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    if (!row) {
      row = document.createElement('div');
      row.className = 'cs-tag-row';
      row.style.position = 'absolute';
      row.style.left = '10px';
      row.style.right = '10px';
      row.style.bottom = '66px';
      row.style.display = 'flex';
      row.style.flexWrap = 'wrap';
      row.style.gap = '4px';
      row.style.zIndex = '5';
      row.style.cursor = 'pointer';
      row.style.fontFamily = 'Roboto, Arial, sans-serif';
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTagEditor({ courseId, courseName: getCourseName(card) });
      });
      // Attached once here rather than per-render, so re-renders don't
      // pile up duplicate listeners on the same row.
      row.addEventListener('mouseenter', () => {
        const ghost = row.querySelector('.cs-tag-ghost');
        if (ghost) ghost.style.opacity = '1';
      });
      row.addEventListener('mouseleave', () => {
        const ghost = row.querySelector('.cs-tag-ghost');
        if (ghost) ghost.style.opacity = '0';
      });
      card.appendChild(row);
    }

    row.dataset.csTagsKey = tagsKey;
    row.textContent = '';

    if (tags.length === 0) {
      const ghost = document.createElement('span');
      ghost.className = 'cs-tag-ghost';
      ghost.textContent = '+ add tag';
      ghost.style.fontSize = '11px';
      ghost.style.padding = '2px 8px';
      ghost.style.borderRadius = '10px';
      ghost.style.border = '1px dashed rgba(255,255,255,0.5)';
      ghost.style.color = 'rgba(255,255,255,0.75)';
      ghost.style.opacity = '0';
      ghost.style.transition = 'opacity 0.15s';
      row.appendChild(ghost);
    } else {
      tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.textContent = t;
        chip.style.fontSize = '11px';
        chip.style.padding = '2px 8px';
        chip.style.borderRadius = '10px';
        chip.style.background = 'rgba(0,0,0,0.55)';
        chip.style.color = '#fff';
        row.appendChild(chip);
      });
    }
  }

  function renderAllTags() {
    getCards().forEach(renderTagsForCard);
  }

  function refreshTagsOnCard(courseId) {
    const card = getCards().find((c) => getCourseId(c) === courseId);
    if (card) renderTagsForCard(card);
  }

  // ---------------------------------------------------------------------
  // Tag editor modal
  // ---------------------------------------------------------------------

  let tagModalHost = null;

  function closeTagEditor() {
    if (tagModalHost) {
      tagModalHost.remove();
      tagModalHost = null;
    }
  }

  function openTagEditor(trigger) {
    closeTagEditor();

    const host = document.createElement('div');
    host.id = 'cs-tag-modal';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '1000000';
    document.documentElement.appendChild(host);
    tagModalHost = host;

    // Shadow DOM + createElement (not innerHTML) for the same Trusted
    // Types / style-isolation reasons as the search widget below.
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Roboto, Arial, sans-serif;
      }
      .modal {
        background: #fff;
        color: #202124;
        border-radius: 8px;
        padding: 20px;
        width: 320px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      h3 {
        margin: 0 0 4px;
        font-size: 15px;
      }
      p.sub {
        margin: 0 0 12px;
        font-size: 12px;
        color: #5f6368;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 13px;
        border: 1px solid #dadce0;
        border-radius: 4px;
        outline: none;
        font-family: inherit;
      }
      input:focus {
        border-color: #1a73e8;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      button {
        border: none;
        background: transparent;
        padding: 8px 14px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        font-family: inherit;
      }
      button.save {
        background: #1a73e8;
        color: #fff;
      }
      button.cancel {
        color: #5f6368;
      }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const h3 = document.createElement('h3');
    h3.textContent = 'Tags';

    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = trigger.courseName || 'Class';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. favorite, hard, morning';
    input.value = getTags(trigger.courseId).join(', ');

    const actions = document.createElement('div');
    actions.className = 'actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save';
    saveBtn.textContent = 'Save';

    actions.append(cancelBtn, saveBtn);
    modal.append(h3, sub, input, actions);
    overlay.appendChild(modal);
    shadow.append(style, overlay);

    function doSave() {
      const tags = input.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      setTags(trigger.courseId, tags);
      refreshTagsOnCard(trigger.courseId);
      if (currentQuery) applyFilter();
      closeTagEditor();
    }

    saveBtn.addEventListener('click', doSave);
    cancelBtn.addEventListener('click', closeTagEditor);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeTagEditor();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSave();
      if (e.key === 'Escape') closeTagEditor();
    });

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  // ---------------------------------------------------------------------
  // Backup (export/import) - tags live only in this browser's
  // localStorage, so there's no way to carry them to another browser or
  // computer, or recover them if site data gets cleared, without this.
  // ---------------------------------------------------------------------

  function exportTagsFile() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tags: loadAllTags(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'classroom-tags.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Accepts either a {version, tags: {...}} export, or a bare
  // {courseId: [...]} object (in case someone hand-edits a file), and
  // strips anything that isn't a clean array of non-empty strings.
  function parseImportedTags(text) {
    const parsed = JSON.parse(text);
    const tagsObj =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.tags
        ? parsed.tags
        : parsed;
    if (!tagsObj || typeof tagsObj !== 'object' || Array.isArray(tagsObj)) {
      throw new Error('Not a valid tags file.');
    }
    const clean = {};
    Object.keys(tagsObj).forEach((courseId) => {
      const val = tagsObj[courseId];
      if (!Array.isArray(val)) return;
      const tags = val
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim());
      if (tags.length) clean[courseId] = tags;
    });
    return clean;
  }

  let backupModalHost = null;

  function closeBackupModal() {
    if (backupModalHost) {
      backupModalHost.remove();
      backupModalHost = null;
    }
  }

  function openBackupModal() {
    closeBackupModal();
    closeTagEditor();

    const host = document.createElement('div');
    host.id = 'cs-backup-modal';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '1000000';
    document.documentElement.appendChild(host);
    backupModalHost = host;

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Roboto, Arial, sans-serif;
      }
      .modal {
        background: #fff;
        color: #202124;
        border-radius: 8px;
        padding: 20px;
        width: 340px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      h3 {
        margin: 0 0 4px;
        font-size: 15px;
      }
      p.sub {
        margin: 0 0 16px;
        font-size: 12px;
        color: #5f6368;
      }
      .section {
        margin-bottom: 16px;
      }
      .section:last-of-type {
        margin-bottom: 0;
      }
      .section-title {
        font-size: 12px;
        font-weight: 500;
        margin-bottom: 6px;
      }
      .section-desc {
        font-size: 11px;
        color: #5f6368;
        margin-bottom: 8px;
      }
      button {
        border: none;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        font-family: inherit;
        padding: 8px 14px;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      button.primary {
        background: #1a73e8;
        color: #fff;
      }
      button.secondary {
        background: #f1f3f4;
        color: #202124;
      }
      .msg {
        font-size: 12px;
        margin-top: 8px;
      }
      .msg.error {
        color: #d93025;
      }
      .msg.ok {
        color: #188038;
      }
      .confirm-box {
        border: 1px solid #dadce0;
        border-radius: 6px;
        padding: 10px;
        margin-top: 8px;
      }
      .confirm-box p {
        margin: 0 0 8px;
        font-size: 12px;
      }
      .confirm-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .close-row {
        display: flex;
        justify-content: flex-end;
        margin-top: 4px;
      }
      input[type='file'] {
        display: none;
      }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';

    const h3 = document.createElement('h3');
    h3.textContent = 'Backup tags';
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent =
      'Tags only live in this browser. Export them to move to another browser/computer, or to keep a backup.';

    // --- Export ---
    const exportSection = document.createElement('div');
    exportSection.className = 'section';
    const exportTitle = document.createElement('div');
    exportTitle.className = 'section-title';
    exportTitle.textContent = 'Export';
    const exportDesc = document.createElement('div');
    exportDesc.className = 'section-desc';
    const tagCount = Object.keys(loadAllTags()).length;
    exportDesc.textContent = tagCount
      ? `Download a file with tags for ${tagCount} ${
          tagCount === 1 ? 'class' : 'classes'
        }.`
      : 'No tags yet - nothing to export.';
    const exportBtn = document.createElement('button');
    exportBtn.className = 'secondary';
    exportBtn.textContent = 'Download tags.json';
    exportBtn.disabled = tagCount === 0;
    exportBtn.addEventListener('click', exportTagsFile);
    exportSection.append(exportTitle, exportDesc, exportBtn);

    // --- Import ---
    const importSection = document.createElement('div');
    importSection.className = 'section';
    const importTitle = document.createElement('div');
    importTitle.className = 'section-title';
    importTitle.textContent = 'Import';
    const importDesc = document.createElement('div');
    importDesc.className = 'section-desc';
    importDesc.textContent =
      'Load tags from a previously exported file. This replaces your current tags.';
    const importBtn = document.createElement('button');
    importBtn.className = 'secondary';
    importBtn.textContent = 'Choose file...';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';

    const msg = document.createElement('div');
    msg.className = 'msg';

    const confirmBox = document.createElement('div');
    confirmBox.className = 'confirm-box';
    confirmBox.hidden = true;
    const confirmText = document.createElement('p');
    const confirmActions = document.createElement('div');
    confirmActions.className = 'confirm-actions';
    const confirmCancelBtn = document.createElement('button');
    confirmCancelBtn.className = 'secondary';
    confirmCancelBtn.textContent = 'Cancel';
    const confirmReplaceBtn = document.createElement('button');
    confirmReplaceBtn.className = 'primary';
    confirmReplaceBtn.textContent = 'Replace tags';
    confirmActions.append(confirmCancelBtn, confirmReplaceBtn);
    confirmBox.append(confirmText, confirmActions);

    let pendingImport = null;

    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      msg.textContent = '';
      msg.className = 'msg';
      confirmBox.hidden = true;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const clean = parseImportedTags(String(reader.result));
          const count = Object.keys(clean).length;
          if (!count) {
            msg.className = 'msg error';
            msg.textContent = 'That file has no tags in it.';
            return;
          }
          pendingImport = clean;
          confirmText.textContent = `Import tags for ${count} ${
            count === 1 ? 'class' : 'classes'
          }? This replaces your current tags.`;
          confirmBox.hidden = false;
        } catch (err) {
          msg.className = 'msg error';
          msg.textContent = "Couldn't read that file - is it a tags export?";
        }
      };
      reader.onerror = () => {
        msg.className = 'msg error';
        msg.textContent = "Couldn't read that file.";
      };
      reader.readAsText(file);
    });

    confirmCancelBtn.addEventListener('click', () => {
      pendingImport = null;
      confirmBox.hidden = true;
    });
    confirmReplaceBtn.addEventListener('click', () => {
      if (!pendingImport) return;
      saveAllTags(pendingImport);
      renderAllTags();
      if (currentQuery) applyFilter();
      confirmBox.hidden = true;
      pendingImport = null;
      msg.className = 'msg ok';
      msg.textContent = 'Tags imported.';
    });

    importSection.append(
      importTitle,
      importDesc,
      importBtn,
      fileInput,
      msg,
      confirmBox
    );

    const closeRow = document.createElement('div');
    closeRow.className = 'close-row';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'secondary';
    closeBtn.textContent = 'Done';
    closeBtn.addEventListener('click', closeBackupModal);
    closeRow.appendChild(closeBtn);

    modal.append(h3, sub, exportSection, importSection, closeRow);
    overlay.appendChild(modal);
    shadow.append(style, overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeBackupModal();
    });
  }

  // ---------------------------------------------------------------------
  // Search widget - lives in Classroom's own header bar, to the left of
  // the "+" / apps-grid / avatar icons.
  //
  // Classroom's header is a flex row that ends in Google's shared
  // cross-product account bar, which always has the id "gb" - that id is
  // common infrastructure used the same way on every Google product, so
  // it's a far more stable anchor than any of Classroom's own obfuscated
  // class names. We walk up from #gb to find the flex-end row that holds
  // it, then insert our widget as that row's first child so it lands
  // just left of the icons. If that search ever fails (a future
  // Classroom redesign, etc.) we fall back to the old floating box below
  // the header so the feature still works, just less integrated.
  // ---------------------------------------------------------------------

  function findHeaderToolbar() {
    const gb = document.getElementById('gb');
    if (!gb) return null;
    let el = gb.parentElement;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (
        cs.display === 'flex' &&
        cs.justifyContent === 'flex-end' &&
        r.top >= 0 &&
        r.top < 100
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function buildWidget() {
    if (document.getElementById(WIDGET_ID)) return;

    const host = document.createElement('div');
    host.id = WIDGET_ID;

    const headerToolbar = findHeaderToolbar();
    if (headerToolbar) {
      host.style.marginRight = '8px';
      headerToolbar.insertBefore(host, headerToolbar.firstChild);
    } else {
      host.style.position = 'fixed';
      host.style.top = '64px';
      host.style.right = '16px';
      host.style.zIndex = '999999';
      document.documentElement.appendChild(host);
    }

    // Shadow DOM keeps our styles from leaking into Classroom's page
    // (and Classroom's styles from leaking into our widget).
    // Built with createElement/textContent rather than innerHTML because
    // Classroom's page enforces a Trusted Types CSP that blocks innerHTML.
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .box {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #fff;
        border: 1px solid #dadce0;
        border-radius: 20px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        padding: 6px 10px;
        font-family: Roboto, Arial, sans-serif;
        font-size: 13px;
      }
      input {
        border: none;
        outline: none;
        font-size: 13px;
        font-family: inherit;
        width: 170px;
        color: #202124;
        background: transparent;
      }
      .status {
        color: #5f6368;
        white-space: nowrap;
        min-width: 60px;
        text-align: right;
      }
      button {
        border: none;
        background: transparent;
        cursor: pointer;
        color: #5f6368;
        font-size: 14px;
        line-height: 1;
        padding: 0 2px;
        visibility: hidden;
      }
      button.show {
        visibility: visible;
      }
    `;

    const box = document.createElement('div');
    box.className = 'box';

    const icon = document.createElement('span');
    icon.textContent = '🔍';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search (/) ';

    const clearBtn = document.createElement('button');
    clearBtn.title = 'Clear';
    clearBtn.textContent = '✕';

    const status = document.createElement('span');
    status.className = 'status';

    const backupBtn = document.createElement('button');
    backupBtn.title = 'Export / import tags';
    backupBtn.textContent = '⇅';
    backupBtn.style.visibility = 'visible';
    backupBtn.style.fontSize = '15px';
    backupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBackupModal();
    });

    box.append(icon, input, clearBtn, status, backupBtn);
    shadow.append(style, box);

    statusEl = status;
    searchInputRef = input;

    input.addEventListener('input', () => {
      currentQuery = input.value;
      clearBtn.classList.toggle('show', currentQuery.length > 0);
      applyFilter();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        currentQuery = '';
        clearBtn.classList.remove('show');
        applyFilter();
        input.blur();
      }
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      currentQuery = '';
      clearBtn.classList.remove('show');
      applyFilter();
      input.focus();
    });

    applyFilter();
  }

  // Global "/" shortcut to focus the search box, like Gmail/GitHub,
  // but only when the user isn't already typing somewhere else.
  //
  // document.activeElement can't see into shadow DOM: if the focused
  // field lives inside a shadow root (our own search/tag-editor inputs,
  // or any of Classroom's own web components), activeElement resolves to
  // the shadow HOST element instead of the actual input, so the old
  // INPUT/TEXTAREA/isContentEditable check silently failed and "/"
  // stole focus while typing. e.composedPath()[0] gives the true
  // originating element regardless of shadow boundaries, so use that.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !searchInputRef) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const target = path[0] || e.target;
    const isTyping =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        (target.closest &&
          target.closest(
            '[contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'
          )));
    if (isTyping) return;
    e.preventDefault();
    searchInputRef.focus();
  });

  // Classroom is a single-page app: it swaps content in and out without
  // full page reloads, and can remove/re-add our widget or load more
  // cards (e.g. switching between "To review" / class lists, or
  // paginating). Watch the page and react, but debounce since
  // Classroom's own DOM churn can be frequent.
  let reactTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(reactTimer);
    reactTimer = setTimeout(() => {
      buildWidget();
      renderAllTags();
      if (currentQuery) applyFilter();
    }, 150);
  });

  function start() {
    buildWidget();
    renderAllTags();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
