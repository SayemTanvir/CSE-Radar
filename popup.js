'use strict';
const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;
const statusNode = document.getElementById('capture-status');
const saveButton = document.getElementById('save-page');
const reviewButton = document.getElementById('review-draft');
const optionsNode = document.getElementById('draft-options');
const candidateSelect = document.getElementById('candidate-select');
let capture = null;
document.getElementById('open-radar').addEventListener('click', async () => {
  try { await extensionAPI.tabs.create({ url: extensionAPI.runtime.getURL('dashboard.html') }); }
  catch (_) { statusNode.textContent = 'Radar could not open. Reload the extension and try again.'; }
});
saveButton.addEventListener('click', async () => {
  saveButton.disabled = true; reviewButton.disabled = true; optionsNode.hidden = true; capture = null;
  statusNode.textContent = 'Checking this page’s published event details…';
  try {
    const [tab] = await extensionAPI.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id) || !/^https?:\/\//i.test(tab.url || '')) {
      statusNode.textContent = 'Open an event website first. Browser settings, new tabs, and local files cannot be captured. You can add an event manually in Radar.';
      return;
    }
    await extensionAPI.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const results = await extensionAPI.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.RadarCapture.scanPage() });
    capture = results[0] && results[0].result;
    if (!capture || !Array.isArray(capture.candidates) || !capture.candidates.length) throw new Error('No capture result.');
    candidateSelect.replaceChildren();
    capture.candidates.forEach((candidate, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = candidate.title || 'Untitled event — add details'; candidateSelect.append(option);
    });
    const warningsNode = document.getElementById('warnings'); warningsNode.replaceChildren();
    capture.warnings.forEach(warning => { const item = document.createElement('li'); item.textContent = warning; warningsNode.append(item); });
    optionsNode.hidden = false; reviewButton.disabled = false;
    statusNode.textContent = capture.candidates.length === 1 ? 'Draft captured. Review the details to save this event.' : `${capture.candidates.length} event drafts found. Choose one to review.`;
    reviewButton.focus();
  } catch (_) {
    statusNode.textContent = 'This page could not be captured. Some websites and browser store pages restrict extension access. Open Radar to add the event manually.';
  } finally { saveButton.disabled = false; }
});
reviewButton.addEventListener('click', async () => {
  if (!capture) return;
  reviewButton.disabled = true; saveButton.disabled = true;
  statusNode.textContent = 'Opening your draft for review…';
  try {
    const response = await extensionAPI.runtime.sendMessage({ type: 'radar:draft:create', capture, candidateIndex: Number(candidateSelect.value) });
    const expectedURL = extensionAPI.runtime.getURL('dashboard.html') + '?draft=';
    if (!response || !response.ok || typeof response.url !== 'string' || !response.url.startsWith(expectedURL)) throw new Error('Draft could not be created.');
    await extensionAPI.tabs.create({ url: response.url });
    statusNode.textContent = 'Draft opened in Radar. Review and save it there.';
  } catch (_) { statusNode.textContent = 'Your draft could not open. Reload CSE Radar and try again, or add the event manually in Radar.'; }
  finally { reviewButton.disabled = false; saveButton.disabled = false; }
});
