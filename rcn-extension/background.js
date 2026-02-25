/**
 * background.js — MV3 service worker
 * Manages recording state in chrome.storage.session.
 * State shape: { recording: boolean, rows: object[], seenIds: object }
 */
'use strict';

const DEFAULT_STATE = { recording: false, rows: [], seenIds: {} };

// When the extension is installed or reloaded, Chrome does not automatically
// re-inject content scripts into already-open tabs. Re-inject them manually
// so the extension works without requiring a page refresh.
async function reinjectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://mapy.geoportal.gov.pl/*' });
  for (const tab of tabs) {
    try {
      // interceptor.js has a guard against double-patching fetch/XHR.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['interceptor.js'],
        world: 'MAIN',
      });
      // bridge.js gets a fresh context — old zombie instance will silently no-op.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['bridge.js'],
      });
    } catch {
      // Tab may have navigated away or be in an incompatible state — ignore.
    }
  }
}

chrome.runtime.onInstalled.addListener(reinjectIntoOpenTabs);

async function getState() {
  const result = await chrome.storage.session.get(['recording', 'rows', 'seenIds']);
  return {
    recording: result.recording ?? false,
    rows: result.rows ?? [],
    seenIds: result.seenIds ?? {},
  };
}

async function setState(patch) {
  await chrome.storage.session.set(patch);
}

async function updateBadge(recording, rowCount) {
  if (recording) {
    await chrome.action.setBadgeText({ text: '●' });
    await chrome.action.setBadgeBackgroundColor({ color: '#cc0000' });
  } else if (rowCount > 0) {
    await chrome.action.setBadgeText({ text: String(rowCount) });
    await chrome.action.setBadgeBackgroundColor({ color: '#555555' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const state = await getState();

    switch (message.type) {
      case 'NEW_ROWS': {
        if (!state.recording) {
          sendResponse({ ok: true });
          return;
        }
        const incoming = message.rows || [];
        const newRows = [];
        const newSeenIds = { ...state.seenIds };
        for (const row of incoming) {
          const id = row['ID transakcji'];
          if (id && newSeenIds[id]) continue;  // deduplicate
          if (id) newSeenIds[id] = true;
          newRows.push(row);
        }
        if (newRows.length > 0) {
          const updatedRows = [...state.rows, ...newRows];
          await setState({ rows: updatedRows, seenIds: newSeenIds });
          await updateBadge(true, updatedRows.length);
        }
        sendResponse({ ok: true, added: newRows.length });
        break;
      }

      case 'GET_STATE': {
        sendResponse({ recording: state.recording, rowCount: state.rows.length });
        break;
      }

      case 'SET_RECORDING': {
        const recording = !!message.recording;
        await setState({ recording });
        await updateBadge(recording, state.rows.length);
        sendResponse({ ok: true });
        break;
      }

      case 'CLEAR_DATA': {
        await setState({ rows: [], seenIds: {} });
        await updateBadge(state.recording, 0);
        sendResponse({ ok: true });
        break;
      }

      case 'GET_ROWS': {
        sendResponse({ rows: state.rows });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;  // keep channel open for async response
});
