const saveTripForm = document.querySelector('#save-trip-form');
const savedList = document.querySelector('#saved-trips');
const savedEditor = document.querySelector('#edit-saved-trip');
const savedStatus = document.querySelector('#saved-status');
const savedError = document.querySelector('#saved-error');
let editingTrip = null;

function refreshSavedTrips() {
  try {
    const trips = tripStorage.read();
    savedList.innerHTML = trips.length ? trips.map(({ id, title, updatedAt, plan: saved }) => `<li data-trip="${escapeHtml(id)}">
      <strong>${escapeHtml(title)}</strong>
      <p class="details">${escapeHtml(saved.region)} · ${escapeHtml(saved.start)} 출발 · ${saved.days}일 · ${saved.people}명</p>
      <p class="details">최근 저장 ${new Date(updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      <div class="saved-actions">
        <button type="button" data-action="open">일정 열기</button>
        <button type="button" data-action="edit">수정</button>
        <button type="button" data-action="export">JSON 내보내기</button>
        <button type="button" data-action="delete">삭제</button>
      </div>
    </li>`).join('') : '<li class="details">저장된 여행 계획이 없습니다.</li>';
  } catch {
    savedError.textContent = '이 브라우저에서 저장된 여행 계획을 읽을 수 없습니다.';
  }
}

function revealSavedTrip(entry) {
  plan = { ...entry.plan, source: 'ai', savedId: entry.id, savedTitle: entry.title };
  activeDay = 0;
  previousPlan = null;
  failedTrace = null;
  revisionMessages.replaceChildren();
  revisionForm.reset();
  revisionStatus.textContent = '';
  revisionError.textContent = '';
  for (const key of ['region', 'start', 'days', 'people', 'budget', 'transport', 'maxStops', 'maxTravelMinutes']) {
    form.elements[key].value = plan[key] ?? '';
  }
  form.elements.request.value = '';
  form.querySelectorAll('[name="taste"]').forEach(input => { input.checked = plan.chosen.includes(input.value); });
  saveTripForm.elements.title.value = entry.title;
  selectTab(tabs[0]);
  refreshRevisionControls();
}

function closeSavedEditor() {
  savedEditor.hidden = true;
  savedEditor.replaceChildren();
  editingTrip = null;
}

function openSavedEditor(entry) {
  editingTrip = entry;
  savedEditor.innerHTML = `<h3>저장된 일정 수정</h3>
    <label class="field">여행 계획 이름<input name="title" maxlength="80" required value="${escapeHtml(entry.title)}"></label>
    ${entry.plan.itinerary.map((day, index) => `<details ${index === 0 ? 'open' : ''}><summary>${index + 1}일차</summary>
      ${day.map(([time, name, , detail, , , visit], stop) => `<fieldset data-saved-stop>
        <legend>${stop + 1}번째 방문</legend>
        <div class="pair">
          <label class="field">시작 시간<input type="time" name="time" value="${escapeHtml(time)}" required></label>
          <label class="field">종료 시간<input type="time" name="end" value="${escapeHtml(visit?.endTime ?? '')}"></label>
        </div>
        <label class="field">장소명<input name="placeName" maxlength="100" value="${escapeHtml(name)}" required></label>
        <label class="field">추천 이유 · 메모<textarea name="detail" rows="2" maxlength="350">${escapeHtml(detail)}</textarea></label>
      </fieldset>`).join('')}</details>`).join('')}
    <div class="saved-actions"><button type="submit" class="submit">변경 저장</button><button type="button" data-action="cancel">취소</button></div>`;
  savedEditor.hidden = false;
  savedEditor.scrollIntoView({ block: 'nearest' });
  savedEditor.elements.title.focus();
}

function savedTripUpdate(entry, editor) {
  const fields = [...editor.querySelectorAll('[data-saved-stop]')];
  let cursor = 0;
  const itinerary = entry.plan.itinerary.map(day => {
    const stops = day.map(([time, name, category, detail, place, route, visit], index) => {
      const inputs = fields[cursor++];
      const start = inputs.querySelector('[name="time"]').value;
      const endTime = inputs.querySelector('[name="end"]').value || null;
      const newName = inputs.querySelector('[name="placeName"]').value.trim();
      if (!newName || !start || (endTime && endTime < start)) throw new Error('장소명과 방문 시작·종료 시간을 확인해 주세요.');
      const renamed = name !== newName;
      return {
        index, renamed,
        stop: [start, newName, renamed ? '기타' : category, inputs.querySelector('[name="detail"]').value.trim(),
          renamed ? null : place, route, { endTime, setting: renamed ? 'unknown' : visit?.setting ?? 'unknown', hours: renamed ? null : visit?.hours ?? null }]
      };
    }).sort((a, b) => a.stop[0].localeCompare(b.stop[0]));
    return stops.map(({ index, renamed, stop }, position) => {
      const previous = stops[position - 1];
      if (!previous || previous.index !== index - 1 || previous.renamed || renamed) stop[5] = null;
      return stop;
    });
  });
  const changed = itinerary.some((day, index) => day.some((stop, position) => {
    const before = entry.plan.itinerary[index][position];
    return [0, 1, 3].some(key => stop[key] !== before[key]) || (stop[6]?.endTime ?? null) !== (before[6]?.endTime ?? null);
  }));
  return changed ? { ...entry.plan, itinerary, validation: null, locallyEdited: true } : entry.plan;
}

function exportSavedTrip(entry) {
  const blob = new Blob([tripStorage.toJson(entry)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = (entry.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '여행-일정') + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

saveTripForm.addEventListener('submit', event => {
  event.preventDefault();
  savedError.textContent = '';
  try {
    if (submitButton.disabled) throw new Error('현재 일정 작업이 끝난 뒤 저장해 주세요.');
    if (plan.source !== 'ai') throw new Error('AI 여행 일정을 먼저 만들어 주세요.');
    const title = saveTripForm.elements.title.value.trim() || plan.savedTitle || `${plan.region} 여행 · ${plan.start}`;
    const entry = tripStorage.save(title, plan, plan.savedId);
    plan.savedId = entry.id;
    plan.savedTitle = entry.title;
    saveTripForm.elements.title.value = entry.title;
    render();
    refreshSavedTrips();
    savedStatus.textContent = '현재 일정을 이 브라우저에 저장했습니다.';
  } catch (error) {
    savedStatus.textContent = '';
    savedError.textContent = error.name === 'QuotaExceededError' ? '브라우저 저장 공간이 부족합니다.' : error.message;
  }
});

savedList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  savedStatus.textContent = '';
  savedError.textContent = '';
  try {
    const entry = tripStorage.read().find(item => item.id === button.closest('[data-trip]').dataset.trip);
    if (!entry) throw new Error('저장된 여행 계획을 찾을 수 없습니다.');
    switch (button.dataset.action) {
      case 'open':
        if (submitButton.disabled) throw new Error('현재 일정 작업이 끝난 뒤 열어 주세요.');
        closeSavedEditor();
        revealSavedTrip(entry);
        document.querySelector('#results').scrollIntoView({ block: 'start' });
        savedStatus.textContent = '저장된 일정을 열었습니다.';
        break;
      case 'edit':
        openSavedEditor(entry);
        break;
      case 'export':
        exportSavedTrip(entry);
        savedStatus.textContent = '여행 계획을 JSON 파일로 내보냈습니다.';
        break;
      case 'delete':
        if (!window.confirm(`“${entry.title}” 여행 계획을 삭제할까요?`)) break;
        tripStorage.remove(entry.id);
        if (editingTrip?.id === entry.id) closeSavedEditor();
        if (plan.savedId === entry.id) {
          delete plan.savedId;
          delete plan.savedTitle;
          render();
          refreshRevisionControls();
        }
        refreshSavedTrips();
        savedStatus.textContent = '저장된 여행 계획을 삭제했습니다.';
        break;
    }
  } catch (error) {
    savedError.textContent = error.message;
  }
});

savedEditor.addEventListener('click', event => {
  if (event.target.closest('[data-action="cancel"]')) closeSavedEditor();
});

savedEditor.addEventListener('submit', event => {
  event.preventDefault();
  if (!editingTrip) return;
  savedStatus.textContent = '';
  savedError.textContent = '';
  try {
    if (submitButton.disabled) throw new Error('현재 일정 작업이 끝난 뒤 수정 내용을 저장해 주세요.');
    const stored = tripStorage.read().find(item => item.id === editingTrip.id);
    if (!stored || stored.updatedAt !== editingTrip.updatedAt) throw new Error('목록에서 최신 저장본을 다시 열어 주세요.');
    const edited = savedTripUpdate(editingTrip, savedEditor);
    const entry = tripStorage.save(savedEditor.elements.title.value.trim(), edited, editingTrip.id);
    closeSavedEditor();
    if (plan.savedId === entry.id) revealSavedTrip(entry);
    refreshSavedTrips();
    savedStatus.textContent = '저장된 여행 계획을 수정했습니다.';
  } catch (error) {
    savedError.textContent = error.message;
  }
});

window.addEventListener('storage', refreshSavedTrips);
refreshSavedTrips();
